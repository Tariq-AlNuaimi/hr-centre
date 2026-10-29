import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { zonedToday } from "@/lib/working-time/calendar";
import { loadSchedule } from "@/lib/working-time/load";
import { loadCaseFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { checkClosureGates } from "./compliance";
import { applyLeaverDeparture } from "./departure";
import { noticeToOwners } from "./notices";
import { settlementClosureProblems } from "./settlement-actions";

/**
 * Close an exit (Offboarding `POST …/close`, AC-10.7 / AC-12.1) — the only way
 * a leaver leaves the working lists. Requires every applicable gate satisfied
 * or overridden, the settlement approved AND paid (when one applies), and the
 * departure applied on the core record (D7) — applied here if the last day of
 * service has passed and the sweep has not done it yet. CASE_CLOSED (F3).
 */

const LIVE = new Set(["ACTIVE", "AT_RISK", "PENDING_SETTLEMENT"]);

export async function closurePreview(actor: JmlActor, caseId: string) {
  await loadCaseFor(actor, caseId, "jml.view", "LEAVE");
  return { problems: await closureProblems(caseId) };
}

async function closureProblems(caseId: string): Promise<string[]> {
  const d = await prisma.jmlExitDetail.findUniqueOrThrow({
    where: { caseId },
    select: {
      nationality: true,
      exitType: true,
      settlementApplicable: true,
      lastDayOfService: true,
      departureAppliedAt: true,
      case: {
        select: {
          gateRecords: { select: { gateId: true, satisfied: true, overriddenById: true } },
        },
      },
    },
  });
  const out: string[] = [];
  const gates = checkClosureGates(d, d.case.gateRecords);
  if (!gates.allowed)
    out.push(`Compliance gates still open: ${gates.outstanding.map((g) => g.gateId).join(", ")}.`);
  if (d.settlementApplicable) out.push(...(await settlementClosureProblems(caseId)));
  if (!d.departureAppliedAt) {
    const today = zonedToday(new Date(), (await loadSchedule()).timeZone);
    if (!d.lastDayOfService || d.lastDayOfService >= today) {
      out.push("The last day of service has not passed, so the departure cannot be applied yet.");
    }
  }
  return out;
}

export async function closeLeave(
  actor: JmlActor,
  caseId: string,
  input: { expectedVersion: number },
) {
  const kase = await loadCaseFor(actor, caseId, "jml.closeLeavers", "LEAVE");
  if (!LIVE.has(kase.status))
    throw new JmlError(`This exit case is ${kase.status.toLowerCase()}.`, 409);
  if (kase.version !== input.expectedVersion)
    throw new JmlError("Someone else changed this case. Reload and try again.", 409);
  const problems = await closureProblems(caseId);
  if (problems.length)
    throw new JmlError(`This exit cannot close yet — ${problems.join(" ")}`, 409);
  const departure = await applyLeaverDeparture(caseId);
  const applied = await prisma.jmlExitDetail.findUniqueOrThrow({
    where: { caseId },
    select: { departureAppliedAt: true },
  });
  if (!applied.departureAppliedAt)
    throw new JmlError(`The departure could not be applied (${departure.note}).`, 409);
  const overridden = await prisma.jmlExitGateRecord.findMany({
    where: { caseId, overriddenById: { not: null } },
    select: { gateId: true },
  });
  await auditedTransaction(async (tx) => {
    await tx.jmlCase.update({
      where: { id: caseId, version: kase.version },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        lastUpdatedById: actor.userId,
        version: { increment: 1 },
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      entityType: "JmlCase",
      entityId: caseId,
      action: "UPDATE",
      after: { closed: true, overriddenGates: overridden.map((g) => g.gateId) },
    });
  });
  await noticeToOwners(caseId, "JML_CASE_CLOSED", `${kase.caseRef} is closed.`, "closed");
  return { closed: true };
}
