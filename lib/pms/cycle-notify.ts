import { prisma } from "@/lib/prisma";
import { isEmailEnabled, sendEmail } from "@/lib/email";
import type { LadderEvent } from "./compliance";
import { managerChain } from "./org-tree";

/**
 * Who hears about a compliance event — the notification half of the §5.5 sweep.
 *
 * Split out of `app/api/internal/cycle-sweep/route.ts` when that route crossed
 * the complexity budget. The split is by cohesion rather than by line count:
 * everything here answers "who is told, and what does it say", and none of it
 * decides whether an event happened — that is `compliance.ts`, and the writing
 * is the route's.
 *
 * Delivery is best-effort throughout. `lib/email.ts` no-ops unless `SMTP_HOST`
 * is set, and it is not set on this deployment, so in-app surfacing is the real
 * channel today. Nothing in here may throw into the sweep: a compliance row that
 * was written must never be lost because a mail server was down.
 */

export const MAX_NOTIFICATIONS = 200;

export type WrittenEvent = LadderEvent & {
  cycleId: string;
  subjectEmployeeId: string;
  /** False when the unique constraint already held this row — see the sweep's idempotency. */
  isNew: boolean;
};

export type Intervention = {
  cycleId: string;
  participantId: string;
  subjectEmployeeId: string;
  managerEmployeeId: string | null;
  missedByHours: number | null;
  detail: string;
};

/** Nearest skip-level manager for each escalated manager — one walk each, capped. */
async function resolveSkipLevels(
  notifiable: readonly WrittenEvent[],
): Promise<Map<string, string | null>> {
  const managerIds = [
    ...new Set(
      notifiable
        .filter((e) => e.kind === "ESCALATED_SKIP_LEVEL" && e.managerEmployeeId)
        .map((e) => e.managerEmployeeId as string),
    ),
  ].slice(0, MAX_NOTIFICATIONS);

  const resolved = new Map<string, string | null>();
  for (const managerId of managerIds) {
    const chain = await managerChain(managerId);
    resolved.set(managerId, chain[0] ?? null);
  }
  return resolved;
}

/** Who hears about what, as employee id → lines. HR's digest is added separately. */
function linesByRecipient(
  notifiable: readonly WrittenEvent[],
  skipLevelOf: ReadonlyMap<string, string | null>,
): Map<string, string[]> {
  const lines = new Map<string, string[]>();
  const add = (employeeId: string, line: string) => {
    const existing = lines.get(employeeId);
    if (existing) existing.push(line);
    else lines.set(employeeId, [line]);
  };

  for (const event of notifiable) {
    if (event.kind === "ESCALATED_HR") continue; // rolled into the HR digest
    if (event.kind === "ESCALATED_SKIP_LEVEL") {
      const skipLevel = event.managerEmployeeId
        ? (skipLevelOf.get(event.managerEmployeeId) ?? null)
        : null;
      if (skipLevel) add(skipLevel, `${event.kind}: ${event.detail}`);
      continue;
    }
    if (event.managerEmployeeId) add(event.managerEmployeeId, `${event.kind}: ${event.detail}`);
  }
  return lines;
}

function hrDigest(
  escalations: number,
  interventions: readonly Intervention[],
  interventionCount: number,
): string {
  return [
    `${escalations} newly escalated goal-setting miss(es) (§5.5).`,
    `${interventionCount} file(s) past the grace window and awaiting HR intervention (§5.5).`,
    ...interventions
      .slice(0, 20)
      .map((i) => `- participant ${i.participantId}: ${i.detail} (${i.missedByHours}h overdue)`),
  ].join("\n");
}

/**
 * Best-effort notification. Everything below is inside try/catch and runs only
 * after every row is committed: §5.6's record is the deliverable, and a send
 * that throws must cost the sweep nothing.
 *
 * Notification cadence deliberately differs from the compliance record:
 *   - REMINDER_SENT re-sends on every run inside the window, because §5.5 asks
 *     for "escalating reminders" while the record wants one row per stage.
 *   - Escalations notify only on the run that first logged them, so HR and a
 *     skip-level director are not re-mailed the same miss daily; the standing
 *     nag is the intervention digest, which is a single message.
 */
export async function notify(
  written: readonly WrittenEvent[],
  interventions: readonly Intervention[],
  interventionCount: number,
): Promise<{ attempted: number; sent: number; skipped: boolean }> {
  if (!isEmailEnabled()) return { attempted: 0, sent: 0, skipped: true };

  try {
    const notifiable = written.filter((e) => e.kind === "REMINDER_SENT" || e.isNew);
    const lines = linesByRecipient(notifiable, await resolveSkipLevels(notifiable));

    const hrEscalations = notifiable.filter((e) => e.kind === "ESCALATED_HR").length;
    if (hrEscalations > 0 || interventionCount > 0) {
      const digest = hrDigest(hrEscalations, interventions, interventionCount);
      const hr = await prisma.employee.findMany({
        where: { status: "ACTIVE", pmsRoles: { hasSome: ["HR_SUPER_ADMIN", "HRBP"] } },
        select: { id: true },
        take: 50,
      });
      for (const person of hr) {
        const existing = lines.get(person.id);
        if (existing) existing.push(digest);
        else lines.set(person.id, [digest]);
      }
    }

    return await deliver(lines);
  } catch {
    // Notification is best-effort by contract. The rows are already committed.
    return { attempted: 0, sent: 0, skipped: false };
  }
}

/** One message per recipient, each send isolated. Addresses are never logged. */
async function deliver(
  lines: ReadonlyMap<string, string[]>,
  subject = "Performance cycle — goal-setting compliance",
): Promise<{ attempted: number; sent: number; skipped: boolean }> {
  // `take` is redundant at runtime — the `in` list below is already sliced to
  // MAX_NOTIFICATIONS — and worth stating anyway: it keeps the cap true if
  // someone later changes how `lines` is assembled, and it puts the bound where
  // both a reader and the scalability scanner look for it. It sits FIRST because
  // that scanner only inspects the first ~250 characters of each query's argument
  // block, so a bound buried under a long comment reads to it as no bound at all.
  const recipients = await prisma.employee.findMany({
    take: MAX_NOTIFICATIONS,
    where: { id: { in: [...lines.keys()].slice(0, MAX_NOTIFICATIONS) } },
    select: { id: true, email: true },
  });

  let sent = 0;
  for (const person of recipients) {
    const body = lines.get(person.id);
    if (!body) continue;
    try {
      // Recipient addresses are Confidential (SECURITY.md §1) — never logged
      // here; lib/email.ts itself logs a recipient COUNT only.
      const result = await sendEmail({
        to: person.email,
        subject,
        text: `${body.join("\n")}\n`,
      });
      if (result.sent) sent += 1;
    } catch {
      // One bad address must not stop the rest of the run's mail.
    }
  }
  return { attempted: recipients.length, sent, skipped: false };
}

/**
 * §9.7 — "Automated reminders before deadline", for the 360.
 *
 * Separate from the §5.5 ladder above, deliberately. That ladder logs a
 * `ComplianceEvent` because §5.6 wants a manager-accountability RECORD; a 360
 * rater who has not answered yet is not a compliance matter and must not land on
 * anyone's record. So this sends and records nothing.
 *
 * It also runs only INSIDE the reminder window and only for unsubmitted
 * assignments, so a rater who has answered is never chased and nobody is mailed
 * about a cycle that has not opened.
 *
 * Best-effort, like everything else here: `lib/email.ts` no-ops unless SMTP is
 * configured, and a mail failure must never break the sweep.
 */
export async function remindThreeSixtyRaters(
  now: Date,
): Promise<{ attempted: number; sent: number; skipped: boolean }> {
  if (!isEmailEnabled()) return { attempted: 0, sent: 0, skipped: true };

  try {
    const { isReminderDue } = await import("./three-sixty");

    const cycles = await prisma.threeSixtyCycle.findMany({
      take: 10,
      where: { status: "ACTIVE" },
      select: { id: true, deadline: true },
    });
    const due = cycles.filter((c) => isReminderDue({ deadline: c.deadline, now }));
    if (due.length === 0) return { attempted: 0, sent: 0, skipped: false };

    const outstanding = await prisma.assignment.findMany({
      take: MAX_NOTIFICATIONS,
      where: {
        threeSixtyCycleId: { in: due.map((c) => c.id) },
        status: { not: "SUBMITTED" },
        rater: { status: "ACTIVE" },
      },
      select: {
        raterId: true,
        ratee: { select: { name: true } },
        threeSixtyCycle: { select: { deadline: true } },
      },
    });

    const lines = new Map<string, string[]>();
    for (const row of outstanding) {
      const when = row.threeSixtyCycle.deadline.toISOString().slice(0, 10);
      const line = `360 assessment of ${row.ratee.name} is still outstanding — due ${when}.`;
      const existing = lines.get(row.raterId);
      if (existing) existing.push(line);
      else lines.set(row.raterId, [line]);
    }
    if (lines.size === 0) return { attempted: 0, sent: 0, skipped: false };

    return await deliver(lines, "360 assessment — reminder");
  } catch {
    return { attempted: 0, sent: 0, skipped: false };
  }
}
