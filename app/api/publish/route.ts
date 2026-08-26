import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import { isHrSuperAdmin } from "@/lib/pms/permissions";
import { calibrationReadinessBlockedReason } from "@/lib/pms/calibration";
import { publishSchema } from "@/lib/validations/calibration";

/**
 * §13.2 — the publish gate.
 *
 * "Employee results are hidden entirely until HR Super Admin explicitly
 * publishes them — a deliberate final step after all assessments, calibration,
 * and bonus are complete. … Publish is all-at-once, cycle-wide … Guard against
 * accidental triggering: confirmation step + clear warning + ideally a readiness
 * check flagging anything incomplete. Must be impossible to publish by a stray
 * click. Publish is reversible (un-publish), and reversal is audited."
 *
 * Four guards, because the clause asks for four:
 *
 *  1. **HR Super Admin only.** §13.2 names them; §10.6 already separates them
 *     from HRBP on calibration, and releasing results is the larger act.
 *  2. **A typed confirmation.** `confirm: "CONFIRM"` as a literal — a boolean
 *     would be satisfied by any truthy value a mis-wired client sends.
 *  3. **A readiness check.** §10.7: "No release until calibration is done." So
 *     publishing runs the same readiness predicate calibration does, and refuses
 *     while anyone is unscored.
 *  4. **Everything audited.** Both directions, with the reason on un-publish.
 *
 * GET is the readiness check on its own, so the screen can show what is
 * incomplete BEFORE anyone reaches for the button.
 */

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!isHrSuperAdmin(actor)) {
      return err("Only an HR Super Admin publishes results (§13.2).", 403);
    }
    const by = actor.employeeId;
    if (!by) return err("This account has no linked employee record (ADR-065).", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { cycleId, action, reason } = parsed.data;

    const cycle = await prisma.performanceCycle.findUnique({
      where: { id: cycleId },
      // `lastReason` rides along so the audit `before` can carry the reason the
      // publication currently holds — the two snapshots must share their keys or
      // §13.2's WHY never reaches `changes` (see recordAudit below).
      select: {
        id: true,
        publication: { select: { id: true, published: true, lastReason: true } },
      },
    });
    if (!cycle) return notFound("Cycle");

    const currentlyPublished = cycle.publication?.published ?? false;
    if (action === "PUBLISH" && currentlyPublished) {
      return ok({ published: true, alreadyInThatState: true });
    }
    if (action === "UNPUBLISH" && !currentlyPublished) {
      return ok({ published: false, alreadyInThatState: true });
    }

    if (action === "PUBLISH") {
      // §10.7 — "No release until calibration is done."
      const [participantCount, runs, target] = await Promise.all([
        prisma.cycleParticipant.count({ where: { cycleId } }),
        prisma.scoreRun.findMany({
          where: { cycleId },
          take: 1,
          orderBy: { startedAt: "desc" },
          select: { id: true, scoredCount: true },
        }),
        prisma.calibrationTarget.findUnique({ where: { cycleId }, select: { id: true } }),
      ]);
      const blocked = calibrationReadinessBlockedReason({
        participantCount,
        scoredCount: runs[0]?.scoredCount ?? 0,
        hasTarget: target !== null,
      });
      if (blocked) {
        return err(
          `${blocked} §13.2 publishes all-at-once, cycle-wide, so nothing is released until it is.`,
          409,
        );
      }
    }

    const now = new Date();
    const target = action === "PUBLISH";

    // `currentlyPublished` was read outside any transaction, so it is a
    // snapshot. The conditional claim below is the arbiter: a PUBLISH racing an
    // UNPUBLISH (two Super Admins, or a retried request) would otherwise leave
    // the cycle in whichever state committed last, with BOTH audit rows
    // reporting a `before` that was only ever true for one of them. §13.2 asks
    // for a guarded, audited, reversible gate; an audit trail that misreports
    // what it reversed is none of those.
    const publication = await auditedTransaction(async (tx) => {
      if (cycle.publication) {
        // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- conditional claim; recordAudit() below
        const claimed = await tx.cyclePublication.updateMany({
          where: { id: cycle.publication.id, published: currentlyPublished },
          data: target
            ? {
                published: true,
                publishedAt: now,
                publishedByEmployeeId: by,
                lastReason: reason ?? null,
              }
            : {
                published: false,
                publishedAt: null,
                publishedByEmployeeId: null,
                lastReason: reason ?? null,
              },
        });
        if (claimed.count === 0) return null;
      } else {
        await tx.cyclePublication.create({
          data: {
            cycleId,
            published: target,
            publishedAt: target ? now : null,
            publishedByEmployeeId: target ? by : null,
            lastReason: reason ?? null,
          },
          select: { id: true },
        });
      }

      // §13.2 — "reversal is audited (who, when, why)". Both directions, because
      // a publication is as consequential as its reversal. Inside the
      // transaction, so a lost claim takes its audit row with it rather than
      // recording a release that never happened.
      // Symmetric, and under the column's own name. `reason` appeared only in
      // `after`, so §13.2's "reversal is audited (who, when, why)" lost the WHY
      // from `changes` — a key one side lacks yields no entry. `lastReason` is
      // what the column is called, and naming it that keeps the audit trail
      // readable against the schema rather than against this route.
      await recordAudit(tx, {
        entityType: "CyclePublication",
        entityId: cycleId,
        action: "UPDATE",
        before: {
          published: currentlyPublished,
          lastReason: cycle.publication?.lastReason ?? null,
        },
        after: { published: target, lastReason: reason ?? null },
      });

      return tx.cyclePublication.findUniqueOrThrow({
        where: { cycleId },
        select: { id: true, published: true, publishedAt: true, lastReason: true },
      });
    });

    if (publication === null) {
      return err(
        "This cycle's publication state was changed by someone else a moment ago (§13.2).",
        409,
      );
    }

    return ok({ publication, alreadyInThatState: false });
  }),
  { id: "pms-publish", limit: 10, windowMs: 60_000 },
);

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    const cycleId = new URL(request.url).searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");

    const publication = await prisma.cyclePublication.findUnique({
      where: { cycleId },
      select: { published: true, publishedAt: true },
    });

    // An employee may ask whether results are out — that is the one fact §13.1
    // lets them have before their scorecard. Everything below is HR's.
    if (!actor.capabilities.orgWide) {
      return ok({ published: publication?.published ?? false });
    }

    const [participantCount, runs, target] = await Promise.all([
      prisma.cycleParticipant.count({ where: { cycleId } }),
      prisma.scoreRun.findMany({
        where: { cycleId },
        take: 1,
        orderBy: { startedAt: "desc" },
        select: { id: true, scoredCount: true, skippedCount: true, finishedAt: true },
      }),
      prisma.calibrationTarget.findUnique({ where: { cycleId }, select: { id: true } }),
    ]);

    const blocked = calibrationReadinessBlockedReason({
      participantCount,
      scoredCount: runs[0]?.scoredCount ?? 0,
      hasTarget: target !== null,
    });

    // §13.2's "readiness check flagging anything incomplete" — shown BEFORE
    // anyone reaches for the button, not as a refusal after they press it.
    return ok({
      published: publication?.published ?? false,
      publishedAt: publication?.publishedAt ?? null,
      readiness: {
        ready: blocked === null,
        reason: blocked,
        participantCount,
        scoredCount: runs[0]?.scoredCount ?? 0,
        skippedCount: runs[0]?.skippedCount ?? 0,
        hasTarget: target !== null,
      },
    });
  }),
  { id: "pms-publish-read", limit: 120, windowMs: 60_000 },
);
