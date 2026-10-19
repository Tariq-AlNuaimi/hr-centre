import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { canRunCycle } from "@/lib/pms/cycle";
import { stageReopensUnacknowledged } from "@/lib/pms/change-request";
import { updateCycleStagesSchema } from "@/lib/validations/cycle";

/**
 * Stage deadlines — spec §2 ("HR sets deadlines for each stage") and §5.5.
 *
 * Editing a deadline on an OPEN cycle is not an escape hatch, it is one of the
 * three formal interventions §5.5 gives HR when a stage has gone past grace:
 * "extend the deadline, intervene directly, or mark a formal non-compliance
 * event". It runs through the audit extension like any other write, so an
 * extension is visible as a decision someone made rather than as a deadline
 * that quietly moved.
 *
 * A CLOSED cycle is immutable: §10's calibration and §13's publish gate both
 * assume a finished year stops moving.
 *
 * **Extending the mid-year deadline reopens the requests that deadline locked**
 * (§6.2, ADR-072 decision 3 option A). The stage move and the reopen are ONE
 * transaction, because the failure they exist to prevent is precisely a new
 * deadline sitting above requests that are still dead — which is the state HR
 * used this remedy to get out of.
 */

/**
 * The reopen is a per-row write inside the stage transaction, so this cap and
 * the two timeouts below are one budget and move together.
 *
 * At most one request per participant can be pending at a time (the partial
 * unique index), so 1,000 is a thousand-person org with a locked request on
 * every single person — far past anything this fork is sized for. Raising it
 * without raising `maxDuration` and the transaction timeout is how an extension
 * starts failing on exactly the large org that needed it.
 */
const MAX_REOPENED_PER_EXTENSION = 1_000;

/**
 * The reopen makes this a longer write than a three-row deadline edit. Vercel's
 * smaller plans default to 10s, which a few hundred per-row updates can exceed
 * — and a timeout here is the worst outcome available, because it rolls the
 * extension back and leaves HR looking at the locked requests they were trying
 * to free. Same reasoning, and the same number, as the import apply route.
 */
export const maxDuration = 60;
export const PUT = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!canRunCycle(actor)) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = updateCycleStagesSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id },
      select: { id: true, status: true, year: true },
    });
    if (!cycle) return notFound("Cycle");
    if (cycle.status === "CLOSED") {
      return err(`The ${cycle.year} cycle is closed; its deadlines can no longer change.`, 409);
    }

    const kinds = parsed.data.stages.map((s) => s.kind);
    if (new Set(kinds).size !== kinds.length) {
      return err("Each touchpoint may appear only once in a single update");
    }

    // pillar:scalable-ok: bounded at 3 by domain — §2 fixes exactly three
    // touchpoints, CycleStageKind has three members, and @@unique([cycleId, kind])
    // makes a fourth row unrepresentable. `kinds` is itself capped at 3 by zod.
    const existing = await prisma.cycleStage.findMany({
      where: { cycleId: id, kind: { in: kinds } },
      select: { id: true, kind: true },
    });
    const byKind = new Map(existing.map((s) => [s.kind, s.id]));
    const missing = kinds.filter((k) => !byKind.has(k));
    if (missing.length > 0) {
      return err(`This cycle has no ${missing.join(", ")} stage to update`);
    }

    const now = new Date();

    // One update per stage rather than a bulk write: the audit trail should say
    // which deadline moved, and `no-unaudited-bulk-write` enforces that.
    //
    // Wrapped in ONE transaction with the reopen below. `tx` is the extended
    // client, so both writes audit themselves, and HR is the actor on every row
    // — an extension and the requests it revived read as one decision by one
    // person, which is what §12.2 wants of it.
    const reopened = await auditedTransaction(
      async (tx) => {
        for (const stage of parsed.data.stages) {
          await tx.cycleStage.update({
            where: { id: byKind.get(stage.kind) as string },
            data: { opensAt: stage.opensAt, deadline: stage.deadline, graceDays: stage.graceDays },
          });
        }

        // §6.2 — the lock the deadline wrote is the deadline's to take back.
        const reopens = parsed.data.stages.some((stage) =>
          stageReopensUnacknowledged({
            stage: {
              kind: stage.kind,
              opensAt: stage.opensAt,
              deadline: stage.deadline,
              graceDays: stage.graceDays,
            },
            now,
          }),
        );
        if (!reopens) return 0;

        const locked = await tx.kpiChangeRequest.findMany({
          where: {
            status: "NOT_ACKNOWLEDGED",
            // Belt and braces: `NOT_ACKNOWLEDGED` is only ever written to an
            // unacknowledged row, and this says so to the next reader rather than
            // making them go and check the sweep.
            acknowledgedAt: null,
            participant: { cycleId: id },
          },
          select: { id: true },
          take: MAX_REOPENED_PER_EXTENSION,
        });

        // Per-row `update`, not `updateMany`: the audit extension covers `update`
        // automatically, and §6.3's history should name each request that came
        // back rather than record one bulk event with a count.
        for (const row of locked) {
          await tx.kpiChangeRequest.update({
            where: { id: row.id },
            data: { status: "PENDING" },
          });
        }
        return locked.length;
      },
      {
        // Prisma's interactive-transaction default is 5s, which is fine for three
        // stage rows and not fine once several hundred reopens join them in the
        // same transaction. Kept under `maxDuration` so the function's own ceiling
        // is what bites first, with a diagnosable error rather than a hard kill.
        timeout: 45_000,
        maxWait: 10_000,
      },
    );

    // pillar:scalable-ok: same bound — one cycle has at most three stages.
    const stages = await prisma.cycleStage.findMany({
      where: { cycleId: id },
      orderBy: { opensAt: "asc" },
      select: { id: true, kind: true, opensAt: true, deadline: true, graceDays: true },
    });
    // `reopened` travels in the response so HR's screen can say "3 locked
    // change requests are live again" rather than leaving them to notice.
    return ok({ stages, reopenedChangeRequests: reopened });
  }),
  { id: "pms-cycle-stages-write", limit: 30, windowMs: 60_000 },
);
