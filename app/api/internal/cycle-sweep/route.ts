import type { ComplianceKind } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { ok } from "@/lib/api-response";
import { withInternalAuth, withRateLimit } from "@/lib/api-helpers";
import { GOAL_SETTING_STAGE } from "@/lib/pms/kpi";
import { MID_YEAR_STAGE } from "@/lib/pms/change-request";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { withAuditContext } from "@/lib/audit-context";
import { hoursOverdue, type StageWindow } from "@/lib/pms/cycle";
import { signOffState } from "@/lib/pms/signoff";
import {
  notify,
  remindThreeSixtyRaters,
  type Intervention,
  type WrittenEvent,
} from "@/lib/pms/cycle-notify";
import {
  hrInterventionDue,
  interventionSummary,
  isLadderExempt,
  ladderEventsFor,
  type LadderEvent,
  type ParticipantComplianceState,
} from "@/lib/pms/compliance";

/**
 * The daily escalation sweep — spec §5.5 (the ladder) and §5.6 (the record).
 *
 * Wired as a Vercel Cron in vercel.json, beside the audit-purge job, and gated
 * by the same CRON_SECRET pattern: Vercel can only issue GET and injects
 * `Authorization: Bearer $CRON_SECRET`, so GET opts into Bearer auth and stays
 * a silent 200 no-op while the secret is unset. POST is the manual / retry
 * door, presenting the same secret as `x-internal-token`.
 *
 * What this endpoint is NOT: a notifier that happens to log. §5.6 asks for the
 * RECORD ("every deadline miss and escalation event is logged automatically"),
 * so the compliance rows are the product and the emails are a side effect. Rows
 * are therefore written FIRST and notifications attempted afterwards, each in
 * its own try/catch — a mail server having a bad morning must never cost §11.2
 * a row it can never recreate, because tomorrow's run will consider the miss
 * already logged.
 *
 * Idempotency comes from the database, not from bookkeeping here:
 * `@@unique([cycleId, stageKind, subjectEmployeeId, kind, measuredAgainstDeadline])`
 * means a retry, a manual invocation, or two overlapping runs collide on P2002,
 * which is caught per row and counted rather than aborting the sweep. A partial
 * run is therefore always safe to repeat.
 *
 * `measuredAgainstDeadline` is in that key deliberately. Without it the identity
 * was scoped to the life of the STAGE, so once HR used §5.5's own remedy and
 * extended a deadline, every later miss re-derived the same three events, hit
 * the index, and was discarded as a duplicate — `missedByHours` frozen at the
 * original figure and nobody notified, because notification only fires for new
 * rows. Found by the post-push breadth review, 2026-08-25.
 */

export const maxDuration = 60;

/** Participants read per query. Bounded pages, never the whole company at once. */
const PARTICIPANT_PAGE = 200;
/**
 * Per-run participant budget. A sweep that cannot finish inside `maxDuration`
 * would roll nothing forward and retry the same oversized job every day; a
 * budget means partial progress commits and tomorrow's run resumes. The ladder
 * is idempotent, so resuming costs nothing but the rows it has yet to reach.
 */
const MAX_PARTICIPANTS_PER_RUN = 5_000;

/**
 * §6.2 — a run's budget for materialising expired change requests. Small on
 * purpose: at most one request per participant can be pending at a time (the
 * partial unique index), so a backlog this size would already be unusual, and
 * anything beyond it is picked up tomorrow with no behavioural difference —
 * the lock itself is derived, not waiting on this.
 */
const MAX_EXPIRED_REQUESTS_PER_RUN = 1_000;

/**
 * The label the sweep writes into `audit_logs.actor_email`. Not an address and
 * not a user id — the deadline closed the request, not a person, and §12.2 is
 * better served by saying so than by a null.
 */
const SWEEP_ACTOR = "system:cycle-sweep";
/** Cap on the intervention queue returned inline, so the response stays bounded. */
const MAX_SURFACED = 100;
/** Cap on outbound mail per run — a backlog must not turn into a mail storm. */

type Counts = Partial<Record<ComplianceKind, number>>;

/**
 * Write one participant's warranted events. Each row is created individually:
 * `createMany` writes no audit rows (`no-unaudited-bulk-write`), and a per-row
 * create is what lets a single duplicate be swallowed without discarding its
 * siblings — the three parallel rungs of a missed deadline are independent
 * facts, and one of them already existing says nothing about the other two.
 */
async function writeEvents(
  cycleId: string,
  stage: StageWindow,
  subjectEmployeeId: string,
  events: readonly LadderEvent[],
): Promise<WrittenEvent[]> {
  const results: WrittenEvent[] = [];
  // The compliance row's identity, minus the kind — carried onto every
  // WrittenEvent so the in-app fan-out can key a notification on the EVENT
  // rather than on a weaker identity of its own (lib/core/notify/store.ts).
  const identity = {
    cycleId,
    subjectEmployeeId,
    stageKind: stage.kind,
    deadlineISO: stage.deadline.toISOString(),
  };

  for (const event of events) {
    try {
      await prisma.complianceEvent.create({
        data: {
          cycleId,
          stageKind: stage.kind,
          subjectEmployeeId,
          managerEmployeeId: event.managerEmployeeId,
          kind: event.kind,
          missedByHours: event.missedByHours,
          detail: event.detail,
          measuredAgainstDeadline: stage.deadline,
        },
        select: { id: true },
      });
      results.push({ ...event, ...identity, isNew: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Already logged by an earlier run AGAINST THIS SAME DEADLINE. The ladder
        // decided the same thing it decided before, which is exactly what
        // idempotence looks like. Had HR extended the deadline, this would be a
        // different key and the row would be written.
        results.push({ ...event, ...identity, isNew: false });
        continue;
      }
      throw error;
    }
  }
  return results;
}

type ParticipantRow = {
  id: string;
  employeeId: string;
  goalsApprovedAt: Date | null;
  /** §3.5 — when they joined the CYCLE. The ladder needs it; see compliance.ts. */
  createdAt: Date;
  employee: {
    id: string;
    managerId: string | null;
    roleTrack: ParticipantComplianceState["roleTrack"];
    status: ParticipantComplianceState["employeeStatus"];
    deletedAt: Date | null;
  };
  signOffs: { party: "EMPLOYEE" | "MANAGER" }[];
};

function stateFor(row: ParticipantRow, kpiCount: number): ParticipantComplianceState {
  const signed = signOffState(row.signOffs);
  return {
    subjectEmployeeId: row.employeeId,
    // §12.2 — the manager of record is whoever holds the relationship NOW.
    managerEmployeeId: row.employee.managerId,
    roleTrack: row.employee.roleTrack,
    employeeStatus: row.employee.status,
    kpiCount,
    employeeSigned: signed.employeeSigned,
    managerSigned: signed.managerSigned,
    goalsApproved: row.goalsApprovedAt !== null,
    enrolledAt: row.createdAt,
  };
}

/** Live KPI counts for a page of participants, in ONE query rather than N. */
async function kpiCounts(participantIds: string[]): Promise<Map<string, number>> {
  if (participantIds.length === 0) return new Map();
  // `deletedAt: null` is explicit: `Kpi` carries soft-delete columns but is not
  // in the soft-delete extension's model set, so nothing filters it for us. A
  // deleted KPI counted here would read as "the manager drafted" for a set the
  // employee cannot see.
  const rows = await prisma.kpi.groupBy({
    by: ["participantId"],
    where: { participantId: { in: participantIds }, deletedAt: null },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.participantId, r._count._all]));
}

type Tally = { scanned: number; skipped: number; duplicates: number; interventionCount: number };

/** One bounded page of participants, keyed by a stable cursor rather than an offset. */
async function fetchParticipantPage(cycleId: string, cursor?: string): Promise<ParticipantRow[]> {
  return prisma.cycleParticipant.findMany({
    where: { cycleId },
    orderBy: { id: "asc" },
    take: PARTICIPANT_PAGE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      employeeId: true,
      goalsApprovedAt: true,
      createdAt: true,
      employee: {
        select: {
          id: true,
          managerId: true,
          roleTrack: true,
          status: true,
          // Nested relation selects are NOT soft-delete filtered (see
          // lib/prisma/soft-delete-extension.ts) — filtered by hand by the caller.
          deletedAt: true,
        },
      },
      // GOAL_SETTING only — see the note in lib/pms/signoff.ts. The ladder
      // escalates on a MISSING signature; a year-end row counted here would
      // silence a genuine goal-setting miss.
      signOffs: { where: { stageKind: GOAL_SETTING_STAGE }, select: { party: true } },
    },
  });
}

async function processParticipant(params: {
  cycleId: string;
  stage: StageWindow;
  now: Date;
  row: ParticipantRow;
  kpiCount: number;
  counts: Counts;
  written: WrittenEvent[];
  interventions: Intervention[];
  tally: Tally;
}): Promise<void> {
  const { cycleId, stage, now, row, kpiCount, counts, written, interventions, tally } = params;
  const state = stateFor(row, kpiCount);

  // §8.3 C-Level and §12.1 leavers are counted as skipped, not scanned: "how
  // many people did the ladder actually consider" is the number an operator
  // checks a sweep against.
  if (isLadderExempt(state)) {
    tally.skipped += 1;
    return;
  }
  tally.scanned += 1;

  const rows = await writeEvents(
    cycleId,
    stage,
    row.employeeId,
    ladderEventsFor(state, stage, now),
  );
  for (const event of rows) {
    if (event.isNew) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
    else tally.duplicates += 1;
    written.push(event);
  }

  if (!hrInterventionDue(state, stage, now)) return;
  tally.interventionCount += 1;
  if (interventions.length >= MAX_SURFACED) return;
  interventions.push({
    cycleId,
    participantId: row.id,
    subjectEmployeeId: row.employeeId,
    managerEmployeeId: state.managerEmployeeId,
    missedByHours: hoursOverdue(stage, now),
    detail: interventionSummary(state),
  });
}

async function sweepStage(
  cycleId: string,
  stage: StageWindow,
  now: Date,
  counts: Counts,
  written: WrittenEvent[],
  interventions: Intervention[],
): Promise<Tally> {
  const tally: Tally = { scanned: 0, skipped: 0, duplicates: 0, interventionCount: 0 };
  let cursor: string | undefined;

  while (tally.scanned + tally.skipped < MAX_PARTICIPANTS_PER_RUN) {
    const page = await fetchParticipantPage(cycleId, cursor);
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    const live = page.filter((row) => row.employee.deletedAt === null);
    const countsByParticipant = await kpiCounts(live.map((row) => row.id));
    for (const row of live) {
      await processParticipant({
        cycleId,
        stage,
        now,
        row,
        kpiCount: countsByParticipant.get(row.id) ?? 0,
        counts,
        written,
        interventions,
        tally,
      });
    }

    if (page.length < PARTICIPANT_PAGE) break;
  }

  return tally;
}

/**
 * §6.2 — materialise the requests the mid-year deadline closed.
 *
 * `effectiveChangeRequestStatus` already DERIVES this verdict on every read, so
 * nothing downstream waits on this function to be correct: the lock holds from
 * the instant the deadline passes whether or not the cron ever runs. What this
 * adds is the RECORD — §6.3 wants a history that states what happened rather
 * than one every reader has to recompute against a clock.
 *
 * That ordering is deliberate and worth keeping: a sweep that never runs costs
 * the history a row, never a wrongly-approved KPI.
 *
 * Per-row update with its own audit entry rather than one `updateMany`, for the
 * reason ADR-010 gives — a bulk write leaves no trail, and "the deadline closed
 * this request" is exactly the kind of act nobody is around to witness.
 */
async function lockUnacknowledgedRequests(now: Date): Promise<number> {
  const expired = await prisma.kpiChangeRequest.findMany({
    take: MAX_EXPIRED_REQUESTS_PER_RUN,
    where: {
      status: "PENDING",
      acknowledgedAt: null,
      participant: {
        cycle: {
          status: "OPEN",
          stages: { some: { kind: MID_YEAR_STAGE, deadline: { lt: now } } },
        },
      },
    },
    select: { id: true },
  });

  let locked = 0;
  for (const row of expired) {
    try {
      // Counted from the transaction's RESULT, not from inside it: incrementing
      // in the callback counts a row whose commit then fails, and the number
      // this returns is what the cron's log says happened.
      //
      // §12.2 wants WHO on every row. `withInternalAuth` establishes no audit
      // context — there is no session, because the cron is not a person — so
      // without this the trail read `userId: null, actorEmail: null` and the one
      // act nobody is present to witness was also the one act the trail could
      // not attribute. A system label is not a user id and is not pretending to
      // be one; it is the honest answer to "who closed this".
      const didLock = await withAuditContext({ actorEmail: SWEEP_ACTOR }, async () =>
        auditedTransaction(async (tx) => {
          // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- conditional claim; recordAudit() below
          const claimed = await tx.kpiChangeRequest.updateMany({
            where: {
              id: row.id,
              status: "PENDING",
              acknowledgedAt: null,
              // The claim re-asserts the DEADLINE, not just the status. The
              // list above was read at the top of the run and up to a thousand
              // transactions follow it; HR extending the stage in that window
              // would leave this claim writing a lock under a window that is
              // open again — the "same act, two outcomes by timing" that
              // ADR-072 option A exists to remove, reappearing from the other
              // side. Re-checking here makes the claim a no-op instead.
              participant: {
                cycle: { stages: { some: { kind: MID_YEAR_STAGE, deadline: { lt: now } } } },
              },
            },
            data: { status: "NOT_ACKNOWLEDGED" },
          });
          if (claimed.count === 0) return false;
          await recordAudit(tx, {
            entityType: "KpiChangeRequest",
            entityId: row.id,
            action: "UPDATE",
            before: { status: "PENDING", acknowledgedAt: null },
            after: { status: "NOT_ACKNOWLEDGED", acknowledgedAt: null },
          });
          return true;
        }),
      );
      if (didLock) locked += 1;
    } catch {
      // One stubborn row must not abort the sweep; the next run sees it again
      // because the derivation never stopped treating it as locked.
    }
  }
  return locked;
}

async function sweep() {
  const now = new Date();

  // §2 is one cycle per year and only one is normally OPEN; the cap guards
  // against a fork that opens several, and is not a page.
  const cycles = await prisma.performanceCycle.findMany({
    take: 10,
    where: { status: "OPEN" },
    select: {
      id: true,
      year: true,
      stages: {
        where: { kind: GOAL_SETTING_STAGE },
        select: { kind: true, opensAt: true, deadline: true, graceDays: true },
      },
    },
  });

  const counts: Counts = {};
  const written: WrittenEvent[] = [];
  const interventions: Intervention[] = [];
  let scanned = 0;
  let skipped = 0;
  let duplicates = 0;
  let interventionCount = 0;
  let stagesSwept = 0;

  for (const cycle of cycles) {
    const stage = cycle.stages[0];
    if (!stage) continue;
    stagesSwept += 1;
    const result = await sweepStage(cycle.id, stage, now, counts, written, interventions);
    scanned += result.scanned;
    skipped += result.skipped;
    duplicates += result.duplicates;
    interventionCount += result.interventionCount;
  }

  const notified = await notify(written, interventions, interventionCount, now);
  // §9.7's "automated reminders before deadline". Separate from §5.5's ladder
  // because an unanswered 360 is not a compliance matter and must not land on
  // any manager's record.
  const threeSixtyReminders = await remindThreeSixtyRaters(now);

  // §6.2 — last, and after the compliance rows, for the same reason the
  // notifications are: this is bookkeeping on a verdict that already holds.
  const changeRequestsLocked = await lockUnacknowledgedRequests(now);

  return ok({
    ranAt: now.toISOString(),
    cyclesSwept: cycles.length,
    stagesSwept,
    participantsScanned: scanned,
    participantsSkipped: skipped,
    eventsWritten: counts,
    duplicatesSkipped: duplicates,
    hrInterventionDue: interventionCount,
    hrInterventionQueue: interventions,
    notified,
    threeSixtyReminders,
    changeRequestsLocked,
  });
}

// GET: Vercel Cron (daily, wired in vercel.json). Vercel sends only GET and
// injects `Authorization: Bearer $CRON_SECRET`, so this handler opts into
// Bearer auth and no-ops silently while the secret is unset — a dormant fork
// should not log a failed invocation every day.
export const GET = withRateLimit(
  withInternalAuth("CRON_SECRET", sweep, { bearer: true, skipWhenUnconfigured: true }),
  { id: "cycle-sweep-cron", limit: 5, windowMs: 60_000 },
);
// POST: manual / retry invocation with the same secret as `x-internal-token`.
// The same secret because it authorises the identical action; a separate token
// would be a second thing to rotate for no additional boundary.
export const POST = withRateLimit(withInternalAuth("CRON_SECRET", sweep), {
  id: "cycle-sweep-manual",
  limit: 5,
  windowMs: 60_000,
});
