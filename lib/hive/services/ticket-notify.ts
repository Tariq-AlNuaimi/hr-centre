import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { formatTicketId } from "@/lib/hive/ticket-id";
import { usersHoldingPermission } from "@/lib/rbac/resolve";
import { registerHivePairScopes } from "@/lib/hive/pair-scope";
import { getTicketSettings } from "./ticket-settings";

/**
 * Spec V2 §8.9's HR notifications (blueprint US-T5, phase T3).
 *
 * Four hand-offs:
 * - **opened** → the people who can draft for the ticket's HR Tag pair (their
 *   own pair, or temporary cover for it) — grant-based, so someone whose access
 *   was revoked stops receiving question previews;
 * - **reopened** → the same people plus the drafter, when an employee's
 *   follow-up puts a ticket back in progress;
 * - **submitted** → every approver whose scope covers the pair, minus the
 *   person who wrote the draft (they cannot approve it — Amendment B-3);
 * - **sent** → the person who wrote the draft.
 *
 * Since ADR-075 tickets arrive from Siraaj with nobody watching HIVE's queue, so
 * these are how HR learn there is work at all.
 *
 * Rules every message keeps:
 * - **At most the first 200 characters of the question** (W8). The full text is
 *   behind the link, where permissions apply; email is forwarded, archived and
 *   read on phones.
 * - **No employee name or address.** HR need the ticket, not the person, to know
 *   to open it.
 * - **Never on the critical path.** Sent after the response via `after()`, and a
 *   failed or unconfigured send is swallowed: a notification that cannot go out
 *   must never undo or fail the transition that caused it.
 *
 * @public
 */

const PREVIEW_MAX = 200;

type Kind = "opened" | "reopened" | "submitted" | "sent";

/**
 * Flood backstop on the two pair-wide kinds: past this many tickets for one pair
 * in an hour, further ones wait in the queue without an email each. A leaked
 * MCP token must not turn into mail-bombing HR (post-push review L2).
 */
const PAIR_MAILS_PER_HOUR = 20;

const TICKET_SELECT = {
  id: true,
  ticketNumber: true,
  question: true,
  hrPairId: true,
  draftedById: true,
  hrPair: { select: { name: true } },
  draftedBy: { select: { email: true, deletedAt: true } },
} as const;

type Ticket = NonNullable<Awaited<ReturnType<typeof loadTicket>>>;

function loadTicket(id: string) {
  return prisma.escalation.findUnique({ where: { id }, select: TICKET_SELECT });
}

/** The first 200 characters, cut at a word where one is close. */
export function preview(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_MAX) return flat;
  const cut = flat.slice(0, PREVIEW_MAX);
  const space = cut.lastIndexOf(" ");
  return `${space > PREVIEW_MAX - 40 ? cut.slice(0, space) : cut}…`;
}

registerHivePairScopes();

/** Users linked to a live member of this pair (their OWN_HR_PAIR covers it). */
async function pairMemberUserIds(pairId: string): Promise<Set<string>> {
  const members = await prisma.hrTagMember.findMany({
    where: { pairId, deletedAt: null, userId: { not: null } },
    select: { userId: true },
    take: 50,
  });
  return new Set(members.map((m) => m.userId!));
}

/**
 * Who holds `permission` covering `pairId` right now, via the role builder
 * (`usersHoldingPermission`): GROUP and HR_PAIR holders directly, plus
 * OWN_HR_PAIR holders whose member link is in this pair. `withGroup: false`
 * drops group-wide holders — HIVE's "opened" quirk (US-H6).
 */
async function pairHolders(
  permission: "tickets.draft" | "tickets.approve",
  pairId: string,
  { withGroup }: { withGroup: boolean },
): Promise<Set<string>> {
  const [direct, ownCandidates, members, group] = await Promise.all([
    usersHoldingPermission(permission, { hrPairId: pairId }, { limit: 50 }),
    // Every OWN_HR_PAIR holder "covers" a subject whose actor pairs include it;
    // the member link below decides who really does.
    usersHoldingPermission(
      permission,
      { hrPairId: pairId, actorPairIds: [pairId] },
      { limit: 200 },
    ),
    pairMemberUserIds(pairId),
    withGroup
      ? Promise.resolve([] as string[])
      : usersHoldingPermission(permission, {}, { limit: 200 }),
  ]);
  const out = new Set([...direct, ...ownCandidates.filter((u) => members.has(u))]);
  for (const u of group) out.delete(u);
  return out;
}

async function emailsOf(userIds: Iterable<string>): Promise<string[]> {
  const ids = [...userIds];
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { email: true },
    take: 50,
  });
  return users.map((u) => u.email);
}

/** Live approvers for a pair (group, cover for it, own pair = it), minus the drafter. */
async function approverEmails(pairId: string, excludeUserId: string | null): Promise<string[]> {
  const holders = await pairHolders("tickets.approve", pairId, { withGroup: true });
  if (excludeUserId) holders.delete(excludeUserId);
  return emailsOf(holders);
}

/** People who can draft for the pair: own pair, or a cover assignment for it (not group). */
async function pairDrafterEmails(pairId: string): Promise<string[]> {
  return emailsOf(await pairHolders("tickets.draft", pairId, { withGroup: false }));
}

/** Has this pair already had its hourly share of pair-wide emails? */
async function pairOverQuota(pairId: string): Promise<boolean> {
  const recent = await prisma.escalation.count({
    where: { hrPairId: pairId, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
  });
  return recent > PAIR_MAILS_PER_HOUR;
}

async function recipientsFor(kind: Kind, t: Ticket): Promise<string[]> {
  if (kind === "opened") return pairDrafterEmails(t.hrPairId);
  if (kind === "reopened") {
    const drafter = t.draftedBy && !t.draftedBy.deletedAt ? [t.draftedBy.email] : [];
    return [...(await pairDrafterEmails(t.hrPairId)), ...drafter];
  }
  if (kind === "submitted") return approverEmails(t.hrPairId, t.draftedById);
  return t.draftedBy && !t.draftedBy.deletedAt ? [t.draftedBy.email] : [];
}

/** The message for one hand-off. Exported for the contract test. */
export function composeNotification(
  kind: Kind,
  t: Ticket,
  ticketPrefix?: string,
): { subject: string; text: string } {
  const id = formatTicketId(t.ticketNumber, ticketPrefix);
  const pair = t.hrPair.name;
  // The HR Centre ticket page (same path as HIVE's, so an old link keeps its
  // shape). Locale fixed to `en`, as HIVE: notifications have one language.
  const link = env.AUTH_URL
    ? `${env.AUTH_URL.replace(/\/+$/, "")}/en/hive/escalations/${t.id}`
    : null;
  const head = {
    opened: {
      subject: `New HR ticket ${id} for ${pair}`,
      line: `A new ticket is waiting for ${pair}.`,
    },
    reopened: {
      subject: `${id} reopened — the employee replied`,
      line: `The employee followed up, so this ticket is back in progress for ${pair}.`,
    },
    submitted: {
      subject: `${id} is waiting for your approval`,
      line: `A drafted answer for ${pair} has been submitted for approval.`,
    },
    sent: {
      subject: `${id} — your answer was sent`,
      line: `The answer you drafted was approved and emailed.`,
    },
  }[kind];
  const text = [
    head.line,
    "",
    `Ticket: ${id}`,
    `HR Tag: ${pair}`,
    `Question: ${preview(t.question)}`,
    ...(link ? ["", `Open it: ${link}`] : []),
    "",
    "— HIVE",
  ].join("\n");
  return { subject: head.subject, text };
}

async function deliver(kind: Kind, escalationId: string): Promise<void> {
  try {
    const ticket = await loadTicket(escalationId);
    if (!ticket) return;
    if ((kind === "opened" || kind === "reopened") && (await pairOverQuota(ticket.hrPairId))) {
      return;
    }
    const to = [...new Set((await recipientsFor(kind, ticket)).map((e) => e.trim().toLowerCase()))];
    if (to.length === 0) return;
    const { ticketPrefix } = await getTicketSettings();
    await sendEmail({ to, ...composeNotification(kind, ticket, ticketPrefix) });
  } catch {
    // Deliberately swallowed and not detailed: the error can carry addresses
    // and the question, and the transition it follows has already committed.
    console.warn(`[hive] ${kind} notification for an escalation could not be sent`);
  }
}

/**
 * Queue a notification to run after the response. Outside a request (a script,
 * a test) `after()` is unavailable, so it runs in the background instead.
 */
export function notifyTicket(kind: Kind, escalationId: string): void {
  try {
    after(() => deliver(kind, escalationId));
  } catch {
    void deliver(kind, escalationId);
  }
}
