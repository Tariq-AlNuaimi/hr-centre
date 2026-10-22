import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import { isHr } from "@/lib/pms/permissions";
import { statusChangeBlockedReason } from "@/lib/pms/three-sixty-edit";
import { setThreeSixtyStatusSchema } from "@/lib/validations/three-sixty";

/**
 * §9.7/§9.8 — close, deactivate or reopen a 360 cycle.
 *
 * ## Why this route had to exist
 *
 * `ThreeSixtyStatus` has carried `CLOSED` since the schema was written, and
 * `answerBlockedReason` has refused raters on a closed cycle with "This 360
 * cycle is closed (§9.8)" for just as long — but **nothing in the product ever
 * wrote the column**. Its only writers were the create (`DRAFT`), the window
 * amend (`DRAFT`-gated) and activate (`DRAFT` -> `ACTIVE`). A cycle reached
 * `ACTIVE` and stayed there permanently, which is what blocked the operator:
 * a 360 that cannot end cannot be got out of the way of anything else.
 *
 * So the refusal was built and the act was not. This is the act.
 *
 * ## An explicit target, not a toggle
 *
 * Close, deactivate and reopen are three different decisions with three
 * different consequences, and a toggle cannot say which one HR made. The rules
 * are in `lib/pms/three-sixty-edit.ts` so the screen can grey out and explain
 * exactly what this route would refuse — the inverse of the bug this screen
 * already had, where a §12.1 dialog promised a reassignment no writer accepted.
 *
 * §9.7's LAUNCH is not here: `DRAFT -> ACTIVE` stays with
 * `/api/three-sixty/activate`, which carries §9.4's exactly-three gate.
 */

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHr(actor)) return err("Only HR runs the 360 cycle (§4.1).", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = setThreeSixtyStatusSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { threeSixtyCycleId, status: next, reason } = parsed.data;

    // One read: it answers "does it exist", "what is it now", "is its year
    // still open", and supplies the `before` half of the audit row. The
    // submitted count is what makes "back to draft" safe or unsafe, and it is
    // counted rather than inferred.
    const before = await prisma.threeSixtyCycle.findUnique({
      where: { id: threeSixtyCycleId },
      select: {
        id: true,
        status: true,
        opensAt: true,
        deadline: true,
        cycle: { select: { status: true } },
        _count: { select: { assignments: { where: { status: "SUBMITTED" } } } },
      },
    });
    if (!before) return notFound("360 cycle");

    const blocked = statusChangeBlockedReason({
      current: before.status,
      next,
      performanceYearStatus: before.cycle.status,
      submittedCount: before._count.assignments,
    });
    if (blocked) return err(blocked.reason, blocked.status);

    // ONE conditional statement, not a read then a write — the same shape the
    // window amend uses, and for the same reason: another HR user landing a
    // status change between the check and the write would otherwise have their
    // decision silently overwritten by this one. `updateMany` is how Prisma
    // expresses "only if it is still what I read".
    //
    // `updateMany` skips the audit extension, so the row is written explicitly
    // below (ADR-010's documented escape hatch) — and only when the update
    // actually landed.
    // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- audited explicitly below; a conditional single-row update is the point (see comment)
    const moved = await prisma.threeSixtyCycle.updateMany({
      where: { id: threeSixtyCycleId, status: before.status },
      data: { status: next },
    });
    if (moved.count === 0) {
      return err(
        "Somebody else changed this cycle's status while you were looking at it. Reload and try " +
          "again.",
        409,
      );
    }

    await recordAudit(prisma, {
      entityType: "ThreeSixtyCycle",
      entityId: threeSixtyCycleId,
      action: "UPDATE",
      before: { id: before.id, status: before.status },
      after: {
        id: before.id,
        status: next,
        // Carried so the trail can distinguish a close from a deactivation
        // without the reader reconstructing it from the two status values.
        submittedAtChange: before._count.assignments,
        reason: reason ?? null,
      },
    });

    return ok({
      threeSixty: { id: before.id, status: next },
      submittedCount: before._count.assignments,
    });
  }),
  { id: "pms-360-write", limit: 30, windowMs: 60_000 },
);
