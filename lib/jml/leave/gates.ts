import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { canFor, caseScopeWhere, loadCaseFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import {
  COMPLIANCE_GATES,
  applicableGates,
  checkClosureGates,
  gateDataProblem,
  isGateId,
  type GateId,
} from "./compliance";
import { loadLeaveRow } from "./leave-data";

/**
 * Compliance gates C1–C11 on a case (Offboarding §17.3, `…/compliance`).
 * Recorded by hand: satisfied with a reference, or overridden — overriding is
 * `jml.overrideGates` (HR Manager) with a reason, and audited as its own row so
 * the monthly override report can list it. A gate that does not apply is
 * refused; C8 needs the position classification first (or an override).
 */

const RECORD_SELECT = {
  gateId: true,
  satisfied: true,
  satisfiedAt: true,
  reference: true,
  overriddenById: true,
  overrideReason: true,
  overriddenAt: true,
  satisfiedBy: { select: { name: true } },
  overriddenBy: { select: { name: true } },
} as const;

const profileOf = (d: {
  nationality: string;
  exitType: string;
  settlementApplicable: boolean;
}) => ({
  nationality: d.nationality,
  exitType: d.exitType,
  settlementApplicable: d.settlementApplicable,
});

export async function listGates(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.view", "LEAVE");
  const row = await loadLeaveRow(caseId);
  const profile = profileOf(row.leaveDetail);
  const records = await prisma.jmlExitGateRecord.findMany({
    where: { caseId },
    select: RECORD_SELECT,
    take: 20,
  });
  const byId = new Map(records.map((r) => [r.gateId, r]));
  const incidents = await prisma.jmlExitComplianceIncident.findMany({
    where: { caseId },
    orderBy: { deadlineAt: "desc" },
    select: {
      id: true,
      kind: true,
      gateId: true,
      deadlineAt: true,
      daysLate: true,
      resolvedAt: true,
      note: true,
    },
    take: 20,
  });
  return {
    gates: applicableGates(profile).map((id) => ({
      gateId: id,
      label: COMPLIANCE_GATES[id].label,
      record: byId.get(id) ?? null,
      dataProblem: gateDataProblem(id, row.leaveDetail.positionClassificationName),
    })),
    closure: checkClosureGates(profile, records),
    incidents,
    can: {
      record: canFor(actor, "jml.manageLeavers", kase.subject),
      override: canFor(actor, "jml.overrideGates", kase.subject),
    },
  };
}

export async function recordGate(
  actor: JmlActor,
  caseId: string,
  input: {
    gateId: string;
    satisfied?: boolean;
    reference: string | null;
    override: boolean;
    overrideReason: string | null;
  },
) {
  const kase = await loadCaseFor(
    actor,
    caseId,
    input.override ? "jml.overrideGates" : "jml.manageLeavers",
    "LEAVE",
  );
  if (["DRAFT", "CLOSED", "CANCELLED", "ARCHIVED"].includes(kase.status)) {
    throw new JmlError("Gates are recorded on an active exit case.", 409);
  }
  const row = await loadLeaveRow(caseId);
  if (
    !isGateId(input.gateId) ||
    !applicableGates(profileOf(row.leaveDetail)).includes(input.gateId)
  ) {
    throw new JmlError(`${input.gateId} does not apply to this exit.`, 422);
  }
  const gateId: GateId = input.gateId;
  if (input.override && !input.overrideReason?.trim()) {
    throw new JmlError("An override needs a reason (BR-OFF-028).", 422);
  }
  if (!input.override && input.satisfied) {
    const problem = gateDataProblem(gateId, row.leaveDetail.positionClassificationName);
    if (problem) throw new JmlError(problem, 422);
  }
  const now = new Date();
  const data = input.override
    ? {
        overriddenById: actor.userId,
        overrideReason: input.overrideReason,
        overriddenAt: now,
        reference: input.reference,
      }
    : {
        satisfied: Boolean(input.satisfied),
        satisfiedAt: input.satisfied ? now : null,
        satisfiedById: input.satisfied ? actor.userId : null,
        reference: input.reference,
      };
  await auditedTransaction(async (tx) => {
    const existing = await tx.jmlExitGateRecord.findUnique({
      where: { caseId_gateId: { caseId, gateId } },
      select: { id: true },
    });
    const saved = existing
      ? await tx.jmlExitGateRecord.update({
          where: { id: existing.id },
          data,
          select: { id: true },
        })
      : await tx.jmlExitGateRecord.create({
          data: { caseId, gateId, ...data },
          select: { id: true },
        });
    if (input.override) {
      await recordAudit(tx, {
        entityType: "JmlExitGateRecord",
        entityId: saved.id,
        action: "UPDATE",
        before: null,
        after: { gateOverride: gateId, caseRef: kase.caseRef, reason: input.overrideReason },
      });
    }
  });
  return {
    gateId,
    overridden: input.override,
    satisfied: input.override ? undefined : Boolean(input.satisfied),
  };
}

/** AC-12.3: the month's overrides, newest first, tallied by gate and by actor. */
export async function overridesForMonth(actor: JmlActor, month: string) {
  const scope = caseScopeWhere(actor, "jml.viewReports");
  if (scope === null) throw new JmlError("You do not have permission to do that.", 403);
  const from = new Date(`${month}-01T00:00:00Z`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const rows = await prisma.jmlExitGateRecord.findMany({
    where: { overriddenAt: { gte: from, lt: to }, case: scope },
    orderBy: { overriddenAt: "desc" },
    take: 500,
    select: {
      gateId: true,
      overrideReason: true,
      overriddenAt: true,
      overriddenBy: { select: { name: true } },
      case: { select: { id: true, caseRef: true } },
    },
  });
  const tally = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, count]) => ({ key: k, count }));
  };
  return {
    month,
    rows,
    byGate: tally((r) => r.gateId),
    byActor: tally((r) => r.overriddenBy?.name ?? "—"),
    capReached: rows.length === 500,
  };
}
