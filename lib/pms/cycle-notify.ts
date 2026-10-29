import { usersHoldingPermission } from "@/lib/rbac/resolve";
import { prisma } from "@/lib/prisma";
import { isEmailEnabled } from "@/lib/email";
import { sendLoggedEmail } from "@/lib/core/email/send";
import type { LadderEvent } from "./compliance";
import { managerChain } from "./org-tree";
import {
  hrDigestDedupeKey,
  ladderDedupeKey,
  notificationKindFor,
  threeSixtyDedupeKey,
} from "./notifications";
import { persistNotifications, type PendingNotification } from "@/lib/core/notify/store";

/**
 * Who hears about a compliance event — the notification half of the §5.5 sweep.
 *
 * Split out of `app/api/internal/cycle-sweep/route.ts` when that route crossed
 * the complexity budget. The split is by cohesion rather than by line count:
 * everything here answers "who is told, and what does it say", and none of it
 * decides whether an event happened — that is `compliance.ts`, and the writing
 * is the route's.
 *
 * TWO CHANNELS, ONE RECIPIENT MAP. `lib/email.ts` no-ops unless `SMTP_HOST` is
 * set, and it is not set on this deployment — so until 2026-08-28 this module
 * computed a correct recipient map every morning and returned `skipped: true`
 * without telling anybody. §5.6's record was written and §5.5's ladder reached
 * no one; worst of all the skip-level manager, who has no §4.4 task row to
 * discover it through and whom §5.5 names as the one "with authority to compel
 * action".
 *
 * So the fan-out now PERSISTS an in-app notification for every recipient line,
 * always, and attempts email only if it is configured. Both channels are derived
 * from the same `fanOut()` result, which is the point: they cannot tell two
 * different people two different things, and email is an enhancement rather than
 * a dependency.
 *
 * Delivery is best-effort throughout. Nothing in here may throw into the sweep:
 * a compliance row that was written must never be lost because a mail server was
 * down — or because a notification insert raced a hard-deleted employee.
 */

const MAX_NOTIFICATIONS = 200;

/**
 * Cap on in-app rows written per run — a DIFFERENT bound from
 * `MAX_NOTIFICATIONS`, which counts recipients.
 *
 * One recipient can warrant several rows in a single sweep: the three parallel
 * rungs of a missed deadline, multiplied by every report whose set they missed.
 * Slicing the row list at 200 therefore threw away notifications for people
 * well inside the 200-RECIPIENT mail cap, and threw them away in whatever order
 * the fan-out happened to build — so which manager went untold was arbitrary.
 * Five rows per recipient is generous for the shape the ladder actually
 * produces, and the cap still exists so a pathological backlog cannot write an
 * unbounded number of rows in one cron invocation.
 */
const MAX_PERSISTED_NOTIFICATIONS = MAX_NOTIFICATIONS * 5;

export type WrittenEvent = LadderEvent & {
  cycleId: string;
  subjectEmployeeId: string;
  /**
   * The other two halves of the compliance row's unique tuple. Carried here
   * only so the in-app fan-out can key a notification on the EVENT's identity
   * rather than inventing a weaker one of its own — see `ladderDedupeKey`.
   */
  stageKind: string;
  deadlineISO: string;
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

/**
 * Where a recipient goes to act. Locale-LESS: a 06:00 cron has no viewer and
 * therefore no locale, so the client prefixes its own.
 */
const GOAL_SETTING_HREF = "/goal-setting";
const HR_QUEUE_HREF = "/admin/cycles";

/**
 * One fan-out, two channels.
 *
 * `lines` is what email sends; `notifications` is what the app stores. They are
 * built in the SAME loop from the same decisions on purpose — a recipient set
 * that could differ between channels is a recipient set that eventually does.
 */
type FanOut = { lines: Map<string, string[]>; notifications: PendingNotification[] };

/**
 * Who hears about what. HR's digest is added separately by `notify`.
 *
 * Takes EVERY written event, not just the new ones — the two channels diverge
 * inside `add()`, where the reason for the divergence is written down.
 */
function fanOut(
  notifiable: readonly WrittenEvent[],
  skipLevelOf: ReadonlyMap<string, string | null>,
): FanOut {
  const lines = new Map<string, string[]>();
  const notifications: PendingNotification[] = [];

  const add = (employeeId: string, event: WrittenEvent) => {
    // EMAIL is gated on the per-run `isNew` flag, so HR and a skip-level
    // director are not re-mailed the same miss every morning (REMINDER_SENT is
    // exempt — §5.5 asks for "escalating reminders", plural).
    //
    // IN-APP is NOT gated on it, and that difference is the important one. A
    // notification's "have they been told" lives in the `dedupeKey` unique
    // index, which survives the process; `isNew` lives in memory and survives
    // one run. Gating the feed on `isNew` meant a sweep killed by the cron's
    // 60s ceiling before it reached this point left its compliance rows
    // committed — so tomorrow the ladder re-derives the same events, they come
    // back `isNew: false`, and the skip-level manager this feature exists to
    // reach is never told, permanently, with no retry path. Feeding every
    // written event to the fan-out and letting the index decide makes an
    // interrupted run self-healing instead.
    if (event.kind === "REMINDER_SENT" || event.isNew) {
      const line = `${event.kind}: ${event.detail}`;
      const existing = lines.get(employeeId);
      if (existing) existing.push(line);
      else lines.set(employeeId, [line]);
    }

    notifications.push({
      recipientEmployeeId: employeeId,
      kind: notificationKindFor(event.kind),
      body: event.detail,
      href: GOAL_SETTING_HREF,
      dedupeKey: ladderDedupeKey({
        cycleId: event.cycleId,
        stageKind: event.stageKind,
        subjectEmployeeId: event.subjectEmployeeId,
        kind: event.kind,
        deadlineISO: event.deadlineISO,
        recipientEmployeeId: employeeId,
      }),
    });
  };

  for (const event of notifiable) {
    if (event.kind === "ESCALATED_HR") continue; // rolled into the HR digest
    if (event.kind === "ESCALATED_SKIP_LEVEL") {
      const skipLevel = event.managerEmployeeId
        ? (skipLevelOf.get(event.managerEmployeeId) ?? null)
        : null;
      if (skipLevel) add(skipLevel, event);
      continue;
    }
    if (event.managerEmployeeId) add(event.managerEmployeeId, event);
  }
  return { lines, notifications };
}

function hrDigest(
  escalations: number,
  interventions: readonly Intervention[],
  interventionCount: number,
): string {
  return [
    `${escalations} newly escalated goal-setting miss(es).`,
    `${interventionCount} file(s) past the grace window and awaiting HR intervention.`,
    ...interventions
      .slice(0, 20)
      .map((i) => `- participant ${i.participantId}: ${i.detail} (${i.missedByHours}h overdue)`),
  ].join("\n");
}

/** What one notification run did, per channel. `persisted` is the one that always runs. */
export type NotifyResult = {
  attempted: number;
  sent: number;
  /** True when email is unconfigured. The in-app channel is never skipped. */
  skipped: boolean;
  persisted: { written: number; duplicates: number; failed: number; pending: number };
};

const NOTHING_PERSISTED = { written: 0, duplicates: 0, failed: 0, pending: 0 };

/**
 * Best-effort notification. Everything below is inside try/catch and runs only
 * after every row is committed: §5.6's record is the deliverable, and a send
 * that throws must cost the sweep nothing.
 *
 * Cadence, and why the two channels differ where they do:
 *   - REMINDER_SENT re-MAILS on every run inside the window, because §5.5 asks
 *     for "escalating reminders" while the record wants one row per stage. The
 *     in-app row does NOT repeat: a feed that reprints yesterday's line every
 *     morning is a feed people stop opening, and the dedupe key makes "told
 *     once per event, per deadline" the invariant.
 *   - Escalations mail only on the run that first logged them, so HR and a
 *     skip-level director are not re-mailed the same miss daily; the standing
 *     nag is the intervention digest, which is a single message.
 */
export async function notify(
  written: readonly WrittenEvent[],
  interventions: readonly Intervention[],
  interventionCount: number,
  now: Date,
): Promise<NotifyResult> {
  try {
    const { lines, notifications } = fanOut(written, await resolveSkipLevels(written));

    const hrEscalations = written.filter((e) => e.kind === "ESCALATED_HR" && e.isNew).length;
    if (hrEscalations > 0 || interventionCount > 0) {
      const digest = hrDigest(hrEscalations, interventions, interventionCount);
      // F-c: "HR" is whoever holds `perf.runCycle` for the whole group (the
      // starter HR Super Admin and HRBP roles), resolved from assignments.
      const hrUserIds = await usersHoldingPermission("perf.runCycle", {}, { limit: 50, now });
      const hr = await prisma.employee.findMany({
        where: { status: "ACTIVE", userId: { in: hrUserIds } },
        select: { id: true },
        take: 50,
      });
      // The digest's counts move every day, so unlike a ladder event it is keyed
      // by DAY: HR gets today's queue once, not the same standing figure forever
      // and not a fresh copy on every retry of the same morning's sweep.
      // The sweep's `now`, not a fresh `new Date()`. Everything else in this
      // subsystem takes the clock as a parameter (see compliance.ts's header),
      // and a sweep that crosses midnight UTC would otherwise key its later
      // recipients to a different day and send HR a second digest.
      const dayISO = now.toISOString().slice(0, 10);
      for (const person of hr) {
        const existing = lines.get(person.id);
        if (existing) existing.push(digest);
        else lines.set(person.id, [digest]);
        notifications.push({
          recipientEmployeeId: person.id,
          kind: "HR_INTERVENTION",
          body: digest,
          href: HR_QUEUE_HREF,
          dedupeKey: hrDigestDedupeKey(dayISO, person.id),
        });
      }
    }

    return await deliver(lines, notifications);
  } catch {
    // Notification is best-effort by contract. The rows are already committed.
    return { attempted: 0, sent: 0, skipped: false, persisted: NOTHING_PERSISTED };
  }
}

/**
 * Persist for everyone, then mail whoever we can reach.
 *
 * The order matters and is not arbitrary: the in-app channel is the one that
 * works on this deployment, so it must not be downstream of a mail server's
 * mood. `isEmailEnabled()` is checked HERE and nowhere earlier — the early
 * return that used to sit at the top of `notify()` is exactly what made §5.5
 * inert, and moving it down to the send is the whole change.
 *
 * Addresses are never logged; `lib/email.ts` logs a recipient COUNT only.
 */
async function deliver(
  lines: ReadonlyMap<string, string[]>,
  notifications: readonly PendingNotification[],
  subject = "Performance cycle — goal-setting compliance",
): Promise<NotifyResult> {
  // The cap is passed DOWN rather than applied here: `persistNotifications`
  // filters out what has already been told before spending any of it, so the
  // budget bounds WRITES rather than candidates. Slicing the candidate list
  // here would make a backlog permanently unreachable behind its own first
  // thousand rows — every run would re-derive the same full slice, find it all
  // present, and never advance.
  const persisted = await persistNotifications(notifications, MAX_PERSISTED_NOTIFICATIONS);

  if (!isEmailEnabled()) return { attempted: 0, sent: 0, skipped: true, persisted };

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
      const result = await sendLoggedEmail(
        { to: person.email, subject, text: `${body.join("\n")}\n` },
        {
          module: "performance",
          type: "cycle-ladder",
          subjectType: "employee",
          subjectId: person.id,
        },
      );
      if (result.sent) sent += 1;
    } catch {
      // One bad address must not stop the rest of the run's mail.
    }
  }
  return { attempted: recipients.length, sent, skipped: false, persisted };
}

/**
 * §9.7 — "Automated reminders before deadline", for the 360.
 *
 * Separate from the §5.5 ladder above, deliberately. That ladder logs a
 * `ComplianceEvent` because §5.6 wants a manager-accountability RECORD; a 360
 * rater who has not answered yet is not a compliance matter and must not land on
 * anyone's record. So this writes no compliance row — but it does now write an
 * in-app notification, on the same two-channel footing as everything else here.
 * The distinction that matters is RECORD vs. NOTICE, not stored vs. unstored: a
 * notification is something a rater was told, and telling them is the whole
 * point of §9.7.
 *
 * It also runs only INSIDE the reminder window and only for unsubmitted
 * assignments, so a rater who has answered is never chased and nobody is
 * notified about a cycle that has not opened.
 *
 * Best-effort, like everything else here: a mail failure must never break the
 * sweep, and neither must a notification insert.
 */
export async function remindThreeSixtyRaters(now: Date): Promise<NotifyResult> {
  try {
    const { isReminderDue } = await import("./three-sixty");

    const cycles = await prisma.threeSixtyCycle.findMany({
      take: 10,
      where: { status: "ACTIVE" },
      select: { id: true, deadline: true },
    });
    const due = cycles.filter((c) => isReminderDue({ deadline: c.deadline, now }));
    if (due.length === 0) {
      return { attempted: 0, sent: 0, skipped: !isEmailEnabled(), persisted: NOTHING_PERSISTED };
    }

    const outstanding = await prisma.assignment.findMany({
      take: MAX_NOTIFICATIONS,
      where: {
        threeSixtyCycleId: { in: due.map((c) => c.id) },
        status: { not: "SUBMITTED" },
        rater: { status: "ACTIVE" },
      },
      select: {
        id: true,
        raterId: true,
        ratee: { select: { name: true } },
        threeSixtyCycle: { select: { deadline: true } },
      },
    });

    const lines = new Map<string, string[]>();
    const notifications: PendingNotification[] = [];
    for (const row of outstanding) {
      const deadline = row.threeSixtyCycle.deadline;
      const when = deadline.toISOString().slice(0, 10);
      const line = `360 assessment of ${row.ratee.name} is still outstanding — due ${when}.`;
      const existing = lines.get(row.raterId);
      if (existing) existing.push(line);
      else lines.set(row.raterId, [line]);

      notifications.push({
        recipientEmployeeId: row.raterId,
        kind: "THREE_SIXTY_REMINDER",
        body: line,
        // Straight to the form. This is the one notification whose action is a
        // single click, and §9.7's reminders exist to produce that click.
        href: `/three-sixty/assignments/${row.id}`,
        dedupeKey: threeSixtyDedupeKey(row.id, deadline.toISOString()),
      });
    }
    if (lines.size === 0) {
      return { attempted: 0, sent: 0, skipped: !isEmailEnabled(), persisted: NOTHING_PERSISTED };
    }

    return await deliver(lines, notifications, "360 assessment — reminder");
  } catch {
    return { attempted: 0, sent: 0, skipped: false, persisted: NOTHING_PERSISTED };
  }
}
