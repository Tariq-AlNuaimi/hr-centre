import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { notifyTicket } from "./ticket-notify";
import { answerDueAt } from "./ticket-sla";
import { fold } from "@/lib/hive/civil";
import { loadCompanies, loadHrPairs } from "@/lib/hive/hrtag-source";
import { inCompanyOf, resolveCompany, resolvePair } from "@/lib/hive/hrtag-routing";
import type { EscalationCapture } from "@/lib/validations/hive/escalation";

/**
 * §5.4's escalation capture (US9, AC-9.1–AC-9.3).
 *
 * This is step 3 of the workflow — "the question routes to the correct HR Tag
 * pair based on the employee's stated department/company" — and nothing beyond
 * it. **Creating an escalation cannot send anything.** §5.4 step 5 requires the
 * HR Manager's approval on every single answer, no exceptions, so the row this
 * writes is `NEW` and inert; the send is Phase 5.2's, behind a human.
 *
 * That is also what makes `escalate` safe as the one non-read-only tool on an
 * anonymous surface (ADR-068): the worst a prompt-injected model can do here is
 * put a row in a queue that a person reads.
 *
 * **The routing is `lib/hive/hrtag-routing.ts`, the same module the `hr_tag`
 * tool uses.** Not a copy of it. §4.4's binding note is about three structures
 * being kept independent of each other; a second routing implementation inside
 * the escalation service would be a fourth, silently disagreeing with what HIVE
 * told the employee one message earlier — "your HR Tag is Rahma and Mohammed",
 * then the question lands with Shahed and Afra.
 *
 * @public
 */

/** Where an escalation ended up, and how it got there. */
export interface RoutingOutcome {
  pairId: string;
  pairName: string;
  /** `directorate` | `company` | `selector` | `default` — for the audit trail. */
  matchedOn: string;
}

/**
 * Which pair should own this question?
 *
 * Runs the same rules, from the same module, as the `hr_tag` tool — then, and
 * this is the difference, **always lands somewhere**. The tool can answer "which
 * directorate are you in?", because a conversation can ask again. An escalation
 * cannot: the employee has typed their name, their email and their question, and
 * returning "I could not route this" would either lose the question or force a
 * second interrogation after they have already given everything.
 *
 * So an unroutable escalation goes to the pair HR marked `isDefault`. §6.6 names
 * that pair as the default escalation target, and AC-1.5's rule — "never a
 * generic contact HR" — is satisfied by a real pair with real names rather than
 * by a queue nobody owns.
 */
export async function routeEscalation(input: {
  directorate?: string;
  company?: string;
  companyId?: string | null;
  orgUnitId?: string | null;
}): Promise<RoutingOutcome | null> {
  const [pairs, companies] = await Promise.all([loadHrPairs(), loadCompanies()]);
  const routable = pairs.filter((p) => p.members.length > 0);
  if (routable.length === 0) return null;

  const { company, unknown } = resolveCompany(
    companies,
    input.company ?? "",
    input.companyId ?? null,
  );

  // An unrecognised company NAME is not "no company". Dropping the flag left
  // `company` null, which switches company scoping off entirely — so "Operations"
  // for someone at "Transformation Pioneers Ltd" matched the *Rihal* Operations
  // coverage and filed the question with the pair that does not cover them. The
  // `hr_tag` tool answers `company_unknown` here and names nobody; an escalation
  // cannot ask again, so it takes the default rather than a guess built on a
  // company we could not identify.
  if (unknown) {
    const fallback = routable.find((p) => p.isDefault) ?? routable[0];
    return { pairId: fallback.id, pairName: fallback.name, matchedOn: "default_unknown_company" };
  }

  const inCompany = inCompanyOf(company);

  const resolved = resolvePair(
    routable,
    company,
    fold(input.directorate ?? ""),
    input.directorate ?? "",
    inCompany,
    input.orgUnitId ?? null,
  );

  if (resolved.pair && resolved.matchedOn) {
    // The pair itself, not its display name. `HrTagPair.name` has no unique
    // constraint, so recovering the id by name — as this did first — files the
    // row against the wrong pair the day two pairs share one.
    return {
      pairId: resolved.pair.id,
      pairName: resolved.pair.name,
      matchedOn: resolved.matchedOn,
    };
  }

  // An ambiguity is not a routing decision. Picking one of two pairs at random
  // is worse than the pair HR chose — and `resolvePair` keeps looking past it,
  // so a §3.5 selector that resolves cleanly is still used.
  const fallback = routable.find((p) => p.isDefault) ?? routable[0];
  return {
    pairId: fallback.id,
    pairName: fallback.name,
    matchedOn: resolved.ambiguous ? "default_ambiguous" : "default",
  };
}

/**
 * The core Employee a ticket's email belongs to (ADR-079 §7). `Employee.email`
 * is unique; compared case-insensitively because the ticket email is
 * lower-cased at the boundary and the record may not be.
 */
async function employeeIdFor(email: string): Promise<string | null> {
  const row = await prisma.employee.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, deletedAt: null },
    select: { id: true },
  });
  return row?.id ?? null;
}

export interface CreatedEscalation {
  id: string;
  /** Spec V2 §8.6's running number, rendered with `formatTicketId`. */
  ticketNumber: number;
  threadKey: string;
  pairName: string;
  matchedOn: string;
  /** True when an identical question was already queued — nothing new was written. */
  duplicate?: boolean;
}

/**
 * §7.2's cap on the one write a caller's model can cause: three tickets an hour
 * per employee email (blueprint `hive-siraaj-mcp.md` W2).
 *
 * Keyed on the EMAIL, not a chat session: since ADR-075 tickets arrive from
 * Siraaj over MCP, where there is no HIVE session to count by. Counted from the
 * rows themselves, which is the only place that survives a process restart and
 * the only key a looping model cannot rotate without changing who gets the
 * answer.
 */
const MAX_PER_EMAIL_PER_HOUR = 3;

/**
 * A company-wide ceiling on tickets whose email is only the MODEL's word
 * (post-push review, 2026-10-25). Without Siraaj forwarding the signed-in
 * employee, a looping or prompt-injected model could vary the address and sail
 * past the per-email cap; this bounds that to a number HR can absorb. Tickets
 * with a forwarded identity are not counted — their cap is per real person.
 */
const MAX_UNVERIFIED_PER_HOUR = 30;

/** How long an identical question counts as the same ask rather than a new one. */
const DEDUPE_MINUTES = 30;

/**
 * Write the escalation. `NEW`, unsent, waiting for a human.
 *
 * `sessionId` threads it to a HIVE chat conversation. Since ADR-075 retired
 * the chat it is always null for new tickets; historical ones keep theirs.
 * `source` records where the ticket came from (HIVE's old chat, or Siraaj).
 */
export async function createEscalation(
  capture: EscalationCapture,
  ctx: {
    sessionId: string | null;
    source?: "HIVE" | "SIRAAJ" | "HR";
    identityVerified?: boolean;
    companyId?: string | null;
    orgUnitId?: string | null;
    /** Source HR: who raised it, and the employee record it is for (not matched by email). */
    raisedBy?: { userId: string; employeeId: string; note: string };
  },
): Promise<CreatedEscalation | { error: "no_hr_pairs" } | { error: "rate_limited" }> {
  {
    // Idempotency first. A caller's model that sees a timeout or an error will
    // naturally try again; without this, one person asking one question queues
    // several identical items for HR to read.
    const since = new Date(Date.now() - DEDUPE_MINUTES * 60_000);
    const already = await prisma.escalation.findFirst({
      where: {
        employeeEmail: capture.employeeEmail,
        question: capture.question,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        ticketNumber: true,
        threadKey: true,
        hrPair: { select: { name: true } },
      },
    });
    if (already) {
      return {
        id: already.id,
        ticketNumber: already.ticketNumber,
        threadKey: already.threadKey,
        pairName: already.hrPair.name,
        matchedOn: "existing",
        duplicate: true,
      };
    }

    const recent = await prisma.escalation.count({
      where: {
        employeeEmail: capture.employeeEmail,
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });
    if (recent >= MAX_PER_EMAIL_PER_HOUR) return { error: "rate_limited" };

    if (ctx.source === "SIRAAJ" && !ctx.identityVerified) {
      const unverified = await prisma.escalation.count({
        where: {
          source: "SIRAAJ",
          identityVerified: false,
          createdAt: { gte: new Date(Date.now() - 3_600_000) },
        },
      });
      if (unverified >= MAX_UNVERIFIED_PER_HOUR) return { error: "rate_limited" };
    }
  }

  const routed = await routeEscalation({
    directorate: capture.directorate,
    company: capture.company,
    companyId: ctx.companyId ?? null,
    orgUnitId: ctx.orgUnitId ?? null,
  });
  if (!routed) return { error: "no_hr_pairs" };

  const employeeId = ctx.raisedBy?.employeeId ?? (await employeeIdFor(capture.employeeEmail));
  // UX P1 (tickets P1-2): the internal answer-by time, in working hours.
  const dueAt = await answerDueAt();

  // The ticket and its first history line in one transaction (spec V2 §8.8),
  // so a ticket can never exist without the record of how it was opened.
  const created = await auditedTransaction(async (tx) => {
    const row = await tx.escalation.create({
      data: {
        // HR Centre: the core Employee with this email, when there is one. The
        // name/email stay as snapshots; `identityVerified` says whether the
        // email was the employee's signed-in identity or the model's claim.
        employeeId,
        source: ctx.source ?? "HIVE",
        identityVerified: ctx.identityVerified ?? false,
        hrPairId: routed.pairId,
        employeeName: capture.employeeName,
        employeeEmail: capture.employeeEmail,
        question: capture.question,
        // Explicit rather than relying on the column default: an inert, unsent
        // OPEN ticket is the whole safety property of this function (§5.4 step
        // 5), and a default can change in a migration without anyone reading this.
        status: "OPEN",
        dueAt,
        raisedById: ctx.raisedBy?.userId ?? null,
      },
      // `hrPairId` is selected so the automatic audit row's `after` records WHERE
      // this went, which makes a misroute explainable after the fact.
      select: { id: true, ticketNumber: true, threadKey: true, hrPairId: true },
    });
    await tx.escalationEvent.create({
      data: {
        escalationId: row.id,
        kind: "OPENED",
        actorId: ctx.raisedBy?.userId ?? null,
        note: ctx.raisedBy?.note ?? null,
      },
      select: { id: true },
    });
    return row;
  });

  // US-T5: the pair it was routed to hears about it — queued straight after the
  // commit, before the audit write below, so an audit failure cannot leave an
  // orphan ticket nobody was told about. Not for a duplicate: the early return
  // above already answered that with the existing ticket.
  notifyTicket("opened", created.id);

  // WHY it went there. There is no column for this and adding one is a
  // migration, so it is recorded as its own audit entry rather than being
  // returned and forgotten — "routed to the default because the directorate was
  // ambiguous" is the sentence someone needs six months from now, and the
  // previous comment claimed an audit trail that did not exist.
  await recordAudit(prisma, {
    entityType: "Escalation",
    entityId: created.id,
    action: "CREATE",
    after: { routedTo: routed.pairName, matchedOn: routed.matchedOn },
  });

  return {
    id: created.id,
    ticketNumber: created.ticketNumber,
    threadKey: created.threadKey,
    pairName: routed.pairName,
    matchedOn: routed.matchedOn,
  };
}
