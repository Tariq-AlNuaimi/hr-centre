import { prisma } from "@/lib/prisma";
import type { EscalationSource, EscalationStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The queue and one ticket — the read half of HIVE's escalation-queue service
 * (split for size; behaviour unchanged). Company-wide by design (AC-10.1):
 * viewing has no per-pair filter; acting does.
 *
 * @public
 */

/** What a queue row shows. Deliberately not the whole escalation. */
export const QUEUE_SELECT = {
  id: true,
  ticketNumber: true,
  status: true,
  source: true,
  employeeName: true,
  employeeEmail: true,
  question: true,
  draftAnswer: true,
  sendError: true,
  createdAt: true,
  sentAt: true,
  approvedAt: true,
  submittedAt: true,
  hrPair: { select: { id: true, name: true } },
  draftedBy: { select: { id: true, name: true } },
  submittedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} as const;

/** Rows per page. The queue is a work list, not an archive browser. */
const PAGE = 50;

/** US-T6's queue filters, as validated by `escalationQuerySchema`. */
export interface QueueFilter {
  status?: EscalationStatus;
  cursor?: string;
  pairId?: string;
  /** QA D-03: a drafter/approver without See tickets reads only these pairs. */
  pairIds?: readonly string[];
  source?: EscalationSource;
  /** Instant range on `createdAt`, half-open: `[gte, lt)`. */
  gte?: Date;
  lt?: Date;
  q?: string;
}

/**
 * `HIVE-0047`, `hr-47` or `47` → 47. ANY prefix is accepted, not only the
 * current one: after HR rename the prefix (§8.8 Settings), the emails already
 * sent still quote the old one, and they must keep finding their ticket.
 */
function ticketNumberIn(q: string): number | null {
  const m = /^(?:[a-z][a-z0-9]{0,9}-)?0*(\d{1,9})$/i.exec(q);
  return m ? Number(m[1]) : null;
}

/**
 * The queue's `where`, from its filters. Pure, so each filter is tested on its
 * own. Search matches the ticket number, the employee's name or address, or the
 * question — the four things HR quote when they look a ticket up.
 */
export function queueWhere(f: QueueFilter): Prisma.EscalationWhereInput {
  const where: Prisma.EscalationWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.pairIds) {
    // A pair filter outside the reader's reach matches nothing, never everything.
    where.hrPairId =
      f.pairId !== undefined
        ? f.pairIds.includes(f.pairId)
          ? f.pairId
          : { in: [] }
        : { in: [...f.pairIds] };
  } else if (f.pairId) where.hrPairId = f.pairId;
  if (f.source) where.source = f.source;
  if (f.gte || f.lt) where.createdAt = { ...(f.gte && { gte: f.gte }), ...(f.lt && { lt: f.lt }) };
  if (f.q) {
    const number = ticketNumberIn(f.q);
    const text = { contains: f.q, mode: "insensitive" as const };
    where.OR = [
      ...(number !== null ? [{ ticketNumber: number }] : []),
      { employeeName: text },
      { employeeEmail: text },
      { question: text },
    ];
  }
  return where;
}

/**
 * The queue, company-wide.
 *
 * AC-10.1: "WHEN a Standard user opens the queue THE SYSTEM SHALL show all
 * escalations company-wide, and SHALL NOT show transcripts of conversations the
 * bot handled alone."
 *
 * Both halves are structural. Every escalation is visible to any HR user —
 * there is no per-pair filter, because §5.3 gives the five standard accounts one
 * shared queue rather than five private ones. And the CONVERSATION is not
 * reachable from here: `sessionId` is not selected and no `messages` relation is
 * traversed. Since ADR-075 employees converse in Siraaj, not HIVE; the chat
 * rows from before then stay unread here, and an HR screen does not undo
 * §5.1's anonymity for them.
 */
export async function listEscalations(filter: QueueFilter = {}) {
  const base = queueWhere({ ...filter, status: undefined });
  const where = filter.status ? { ...base, status: filter.status } : base;
  const [rows, counts] = await Promise.all([
    prisma.escalation.findMany({
      where,
      // `id` is a tiebreaker, not decoration. `createdAt` is not unique — two
      // escalations raised in the same millisecond (an employee re-asking, a
      // burst after an announcement) sort arbitrarily, and a cursor page boundary
      // that lands between them silently skips one or repeats one. The row that
      // vanishes is an unanswered question nobody sees again.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: QUEUE_SELECT,
      take: PAGE + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    }),
    // US-T6's live chip counts: the same filters MINUS the status, so the
    // chips say how many each status would show. Bounded by the enum.
    prisma.escalation.groupBy({
      by: ["status"],
      where: base,
      _count: { _all: true },
      orderBy: { status: "asc" },
      take: 20,
    }),
  ]);
  const page = rows.slice(0, PAGE);
  return {
    data: page,
    nextCursor: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<
      Record<EscalationStatus, number>
    >,
  };
}

/** The HR pairs, for the queue's pair filter. A handful; bounded anyway. */
export async function listQueuePairs(pairIds?: readonly string[]) {
  return prisma.hrTagPair.findMany({
    ...(pairIds ? { where: { id: { in: [...pairIds] } } } : {}),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 100,
  });
}

/**
 * One escalation, with its conversation.
 *
 * The follow-up messages are here and NOT in {@link QUEUE_SELECT}, and the
 * difference is AC-10.1: the queue is a work list and must not become a way to
 * read transcripts, while the detail view is the record of this one exchange —
 * which is the thread ADR-070's reply link appends to, and which HR have to see
 * to answer a follow-up at all.
 *
 * `sessionId` stays out of both: any conversation before the escalation stays
 * private (§5.1). What is added here is only what was said AFTER the
 * escalation was raised.
 */
export async function getEscalation(id: string) {
  return prisma.escalation.findUnique({
    where: { id },
    select: {
      ...QUEUE_SELECT,
      // ADR-079: the core Employee this email matched, and whether the email was
      // the employee's signed-in identity (Siraaj forwarded it) or the model's word.
      identityVerified: true,
      employee: { select: { id: true, name: true } },
      messages: {
        // `id` as a tiebreaker: `at` is not unique, and two messages written in
        // the same millisecond rendering in an arbitrary order turns an answer
        // into a question and back.
        orderBy: [{ at: "asc" }, { id: "asc" }],
        select: { id: true, direction: true, body: true, at: true },
        take: 100,
      },
      // Spec V2 §8.8's history log. Bounded like the messages: a ticket's
      // lifecycle is a handful of steps, and 200 is far beyond any real one.
      events: {
        orderBy: [{ at: "asc" }, { id: "asc" }],
        select: {
          id: true,
          kind: true,
          note: true,
          at: true,
          actor: { select: { id: true, name: true } },
        },
        take: 200,
      },
    },
  });
}
