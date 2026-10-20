import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { resolveActor } from "@/lib/pms/actor";
import {
  applyEdit,
  approvalBlockedReason,
  approvalAcknowledgmentReason,
  MID_YEAR_STAGE,
  decideBlockedReason,
  type KpiEdit,
} from "@/lib/pms/change-request";
import {
  CHANGE_REQUEST_SELECT,
  serializeChangeRequest,
  toKpiEdit,
} from "@/lib/pms/change-request-select";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { canViewEmployee } from "@/lib/pms/permissions";
import { decideChangeRequestSchema } from "@/lib/validations/change-request";
import { GOAL_SETTING_STAGE } from "@/lib/pms/kpi";

/**
 * HR decides a mid-year change request — spec §6.2, and §6.3's archive.
 *
 * This is the only place in Phase 3 that MUTATES an HR-approved baseline, and
 * everything about the handler is shaped by that.
 *
 * ## One transaction, in this order
 *
 *   1. re-read the request FOR THIS DECISION and confirm it is still PENDING
 *   2. snapshot every KPI the request touches into `kpi_versions`
 *   3. apply the edits to the live rows
 *   4. mark the request APPROVED
 *
 * Steps 2 and 3 cannot be separated: §6.3 requires "full version history —
 * previous versions archived, never overwritten", and a crash between an applied
 * edit and its missing snapshot destroys the only record of what the employee
 * originally agreed to (§5.1). Written as one `$transaction` rather than as a
 * sequence the route "always" runs in order, because "always" is a property of
 * the happy path only.
 *
 * ## The decision is claimed with a conditional UPDATE
 *
 * `updateMany({ where: { id, status: "PENDING" } })` inside the transaction is
 * the concurrency arbiter: two HR users pressing Approve and Reject at the same
 * moment both pass `decideBlockedReason`, and the one whose UPDATE matches zero
 * rows loses cleanly instead of applying edits on top of a rejection.
 *
 * ## §5.3 is re-checked here, against the set as it stands NOW
 *
 * The submit route checked it too, but the set can move between raising and
 * deciding — a KPI withdrawn mid-draft, another request approved first. The
 * check that matters is the one immediately before the write.
 */

/**
 * Thrown to roll the approval transaction back when §5.3 fails on the re-read.
 *
 * A thrown error rather than a returned sentinel because it must UNDO the claim
 * and any snapshot already written — returning would commit them.
 */
class ApprovalRefused extends Error {}

const KPI_STATE_SELECT = {
  id: true,
  description: true,
  weightage: true,
  descriptorOutstanding: true,
  descriptorExcellent: true,
  descriptorTarget: true,
  descriptorAlmostAchieved: true,
  descriptorUnsatisfactory: true,
  orderIndex: true,
} satisfies Prisma.KpiSelect;

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = decideChangeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { decision, reason, overrideReason } = parsed.data;

    const existing = await prisma.kpiChangeRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        participantId: true,
        acknowledgedAt: true,
        participant: {
          select: {
            employeeId: true,
            // Enumerated columns only — §4.5 keeps `basicSalaryEnc` out of this.
            employee: { select: { id: true } },
            kpis: { where: { deletedAt: null }, select: KPI_STATE_SELECT, take: 200 },
            // §6.2's open question — does an approved mid-year change send the
            // set back for signature? ANSWERED by UAT Scenario C: neither. The
            // employee acknowledges BEFORE the decision, so there is no
            // post-approval signature step and no policy left to read (ADR-072).
            cycle: {
              select: {
                // §6.2 — the acknowledgment gate is a deadline question as much
                // as a consent one, so the window travels with the request. The
                // policy columns used to be selected here for the re-sign
                // option; ADR-072 retired it and nothing reads them now.
                stages: {
                  where: { kind: MID_YEAR_STAGE },
                  select: { kind: true, opensAt: true, deadline: true, graceDays: true },
                },
              },
            },
          },
        },
        edits: CHANGE_REQUEST_SELECT.edits,
      },
    });
    if (!existing) return notFound("Change request");

    // §4.2 — visibility before authority, so a non-HR actor outside the chain
    // learns nothing about which request ids exist.
    const descendants = await visibilityDescendants(actor);
    if (!canViewEmployee(actor, existing.participant.employeeId, descendants)) {
      return notFound("Change request");
    }

    // §6.2 — HR alone decides, and a request is decided once.
    const blocked = decideBlockedReason({ actor, status: existing.status });
    if (blocked) return err(blocked.reason, blocked.status);

    const deciderId = actor.employeeId;
    if (!deciderId) return err("This account has no linked employee record (ADR-065).", 403);

    const edits: KpiEdit[] = existing.edits.map(toKpiEdit);

    // --- rejection: nothing is applied, so nothing is archived ----------------
    //
    // Refusing a change leaves the set exactly as it was, and a set that was
    // already valid stays valid — hence no §5.3 check on this path. The reason
    // is mandatory (§6.2) and the boundary already required it.
    if (decision === "REJECT") {
      // `updateMany` rather than `update` ON PURPOSE: the `status: "PENDING"`
      // predicate is the concurrency arbiter (two HR users deciding at once),
      // and `update` cannot carry it. That takes the write outside the audit
      // extension, so the audit row is written explicitly below — a decision on
      // an HR-approved baseline is exactly what the trail exists for.
      // One transaction, for the same reason the approval path is one: the claim
      // and its audit row are a single fact. Sequential statements leave a window
      // — one Node turn wide, but real — in which the status changed and nothing
      // recorded who changed it, which is precisely what the trail exists to
      // prevent. Raised by the post-push breadth review.
      const rejected = await auditedTransaction(async (tx) => {
        // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- conditional claim; recordAudit() below
        const claimed = await tx.kpiChangeRequest.updateMany({
          where: { id, status: "PENDING" },
          data: {
            status: "REJECTED",
            decidedByEmployeeId: deciderId,
            decidedAt: new Date(),
            decisionReason: reason,
          },
        });
        if (claimed.count === 0) return false;
        // Both snapshots carry the SAME keys. `recordAudit` diffs only the keys
        // both sides hold, so a field named on one side alone yields no `changes`
        // entry at all — the decider and the reason were being written and not
        // reported. A PENDING request has neither on file, so `null` here is the
        // truth about the row before the write, not padding.
        await recordAudit(tx, {
          entityType: "KpiChangeRequest",
          entityId: id,
          action: "UPDATE",
          before: { status: "PENDING", decidedByEmployeeId: null, decisionReason: null },
          after: { status: "REJECTED", decidedByEmployeeId: deciderId, decisionReason: reason },
        });
        return true;
      });
      if (!rejected) {
        return err("This request was decided by someone else a moment ago (§6.2).", 409);
      }
      const row = await prisma.kpiChangeRequest.findUniqueOrThrow({
        where: { id },
        select: CHANGE_REQUEST_SELECT,
      });
      return ok({ changeRequest: serializeChangeRequest(row), applied: 0 });
    }

    // --- approval -------------------------------------------------------------

    // §6.2 — the CONSENT gate, before the weightage one. Two independent
    // questions, and this is the one the spec change introduced: has the
    // employee acknowledged, and if not, may HR override it? Past the mid-year
    // deadline the answer is no either way — that is what makes "no
    // acknowledgment, no change" a rule rather than a preference, and it is why
    // waiting out the deadline is not a way to force a change through.
    const stage = existing.participant.cycle.stages[0] ?? null;
    const consent = approvalAcknowledgmentReason({
      acknowledgedAt: existing.acknowledgedAt,
      overrideReason,
      stage,
      now: new Date(),
    });
    if (consent) return err(consent, 409);

    // An override is only an override when there was no acknowledgment. HR may
    // send a reason with an acknowledged request; it simply is not one.
    const overriding = existing.acknowledgedAt === null;

    // A cheap pre-check so an unapprovable request is refused without opening a
    // transaction. It is NOT the check that counts — see inside the transaction.
    const preflight = approvalBlockedReason({ kpis: existing.participant.kpis, edits });
    if (preflight) return err(preflight, 409);

    const byKpi = new Map(edits.map((e) => [e.kpiId, e]));

    let applied: number | null;
    try {
      applied = await auditedTransaction(async (tx) => {
        // Claim the decision FIRST. If this matches nothing, another decision
        // landed between the read above and here, and the whole transaction —
        // snapshots and edits included — rolls back.
        // Conditional claim, same reasoning as the rejection path above — the
        // predicate is what makes this safe under two simultaneous decisions, and
        // `update` cannot express it. Audited explicitly, INSIDE the transaction,
        // so a rollback takes the audit row with it rather than leaving a record
        // of a decision that never happened.
        // The predicate carries the ACKNOWLEDGMENT state too, not just the
        // status. `overriding` was decided from a read taken before this
        // transaction opened, and the employee can acknowledge in that window —
        // they are a different person acting on a different screen. Claiming on
        // `status` alone would then stamp `acknowledgmentOverridden: true` onto
        // a request the employee HAD acknowledged, which is a false entry in the
        // one history §6.2 exists to keep honest. The database refuses that row
        // outright (`override_excludes_ack_check`), so the race could not
        // corrupt the record — but it would surface to HR as a 500 rather than
        // "reload, they just acknowledged". Binding the claim turns the race
        // into the same 409 every other concurrent decision gets.
        // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- conditional claim; recordAudit() below
        const claimed = await tx.kpiChangeRequest.updateMany({
          where: {
            id,
            status: "PENDING",
            acknowledgedAt: overriding ? null : { not: null },
          },
          data: {
            status: "APPROVED",
            decidedByEmployeeId: deciderId,
            decidedAt: new Date(),
            decisionReason: reason ?? null,
            acknowledgmentOverridden: overriding,
            overrideReason: overriding ? (overrideReason ?? null) : null,
          },
        });
        if (claimed.count === 0) return null;
        // Symmetric, and complete: `decisionReason` is written by the update
        // above (§6.2 makes it mandatory on a REJECT and optional here), so it
        // belongs on both sides or the trail under-reports an approval that
        // carried one.
        await recordAudit(tx, {
          entityType: "KpiChangeRequest",
          entityId: id,
          action: "UPDATE",
          before: {
            status: "PENDING",
            decidedByEmployeeId: null,
            decisionReason: null,
            acknowledgmentOverridden: false,
            overrideReason: null,
          },
          after: {
            status: "APPROVED",
            decidedByEmployeeId: deciderId,
            decisionReason: reason ?? null,
            // §6.2 — an override is the exception, so it goes on the trail
            // explicitly rather than being inferable from a null elsewhere.
            acknowledgmentOverridden: overriding,
            overrideReason: overriding ? (overrideReason ?? null) : null,
          },
        });

        // Re-read the set INSIDE the transaction, and re-run §5.3 against it.
        //
        // The pre-check above ran on a read taken before the transaction opened.
        // Today nothing else can move an approved baseline — `kpiEditBlockedReason`
        // refuses drafting edits after §5.1's approval, and the partial unique
        // index allows only one pending request at a time — but that is an
        // argument assembled from two other files, and it is the kind that stops
        // being true quietly. Archiving a stale "before" would put a version in
        // §6.3's permanent history that never existed. Re-reading makes the
        // transaction answer the question itself.
        const kpis = await tx.kpi.findMany({
          where: { participantId: existing.participantId, deletedAt: null },
          select: KPI_STATE_SELECT,
          take: 200,
        });
        const blockedNow = approvalBlockedReason({ kpis, edits });
        if (blockedNow) throw new ApprovalRefused(blockedNow);

        const touched = kpis.filter((k) => byKpi.has(k.id));

        for (const kpi of touched) {
          // §6.3 — archive the state being SUPERSEDED, before it is overwritten.
          // Version 1 is therefore the KPI as HR originally approved it, and the
          // live row is always the current state; the archive holds every state
          // that has been replaced, in the order it was replaced.
          //
          // `count + 1` rather than `max + 1`: the rows are only ever appended,
          // never deleted (that is what "never overwritten" means), so the count
          // IS the highest version. The unique key `[kpiId, versionNo]` is the
          // backstop if that assumption ever stops holding.
          const versionNo = (await tx.kpiVersion.count({ where: { kpiId: kpi.id } })) + 1;
          await tx.kpiVersion.create({
            data: {
              kpiId: kpi.id,
              versionNo,
              description: kpi.description,
              weightage: kpi.weightage,
              descriptorOutstanding: kpi.descriptorOutstanding,
              descriptorExcellent: kpi.descriptorExcellent,
              descriptorTarget: kpi.descriptorTarget,
              descriptorAlmostAchieved: kpi.descriptorAlmostAchieved,
              descriptorUnsatisfactory: kpi.descriptorUnsatisfactory,
              orderIndex: kpi.orderIndex,
              supersededByRequestId: id,
            },
          });

          // Apply. `applyEdit` is the same function the submit route validated
          // with and the screen previews with, so what HR saw is what lands.
          const next = applyEdit(kpi, byKpi.get(kpi.id));
          await tx.kpi.update({
            where: { id: kpi.id },
            data: {
              description: next.description,
              weightage: new Prisma.Decimal(next.weightage),
              descriptorOutstanding: next.descriptorOutstanding,
              descriptorExcellent: next.descriptorExcellent,
              descriptorTarget: next.descriptorTarget,
              descriptorAlmostAchieved: next.descriptorAlmostAchieved,
              descriptorUnsatisfactory: next.descriptorUnsatisfactory,
            },
          });
        }

        // §6.2 — Rihal's answer to "does anyone sign again?".
        //
        // §6.2's re-sign policy USED to clear the goal-setting signatures here
        // when a cycle opted in. UAT Scenario C answered the question that
        // policy existed to toggle — consent now happens BEFORE the decision,
        // as the employee's acknowledgment — so the branch is gone and the
        // column is retired (ADR-072). `SignOff.kpiSetHash` still surfaces a
        // signature that predates the current set, which is what made the
        // "no" answer honest in the first place.

        return touched.length;
      });
    } catch (error) {
      // §5.3 failed on the re-read: nothing was claimed, archived or applied.
      if (error instanceof ApprovalRefused) return err(error.message, 409);
      throw error;
    }

    if (applied === null) {
      return err(
        "This request moved a moment ago — reload it. Either someone else decided it, or the " +
          "employee acknowledged it while this decision was being made (§6.2).",
        409,
      );
    }

    const row = await prisma.kpiChangeRequest.findUniqueOrThrow({
      where: { id },
      select: CHANGE_REQUEST_SELECT,
    });
    return ok({ changeRequest: serializeChangeRequest(row), applied });
  }),
  { id: "pms-change-request-write", limit: 30, windowMs: 60_000 },
);
