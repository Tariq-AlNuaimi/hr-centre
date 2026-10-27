import type { JmlStage, JmlTaskStatus } from "@/generated/prisma/client";
import { STAGE_ORDER } from "../vocab";

/**
 * Completion and stage gates (HR Offboarding `gates.ts`, AC-4.2 / AC-4.3 /
 * AC-4.4): every function answers "may this happen yet?" with a REASON.
 */

const OPEN = (s: JmlTaskStatus) => s !== "COMPLETED" && s !== "NOT_APPLICABLE" && s !== "CANCELLED";

/** Allowed, or refused with a reason a person can act on. */
export type GateResult = { allowed: true } | { allowed: false; reason: string };
const allow = (): GateResult => ({ allowed: true });
const refuse = (reason: string): GateResult => ({ allowed: false, reason });

export type GateTask = {
  code: string;
  name: string;
  stage: JmlStage;
  status: JmlTaskStatus;
  blocking: boolean;
  confirmationRequired: boolean;
  confirmingParty: string | null;
  confirmationDate: Date | null;
  externalReference: string | null;
  dependsOnCodes: readonly string[];
};

/**
 * AC-6.2 / AC-4.2 / AC-4.4 (Offboarding): may this task be completed now?
 * Refused when already COMPLETED / CANCELLED / NOT_APPLICABLE, when a required
 * confirmation trio is incomplete (each missing part named), or when a task it
 * depends on is not COMPLETED (N/A satisfies; an absent code is ignored).
 */
export function canCompleteTask(task: GateTask, allTasks: readonly GateTask[]): GateResult {
  if (task.status === "COMPLETED") {
    return refuse(`${task.code} is already completed. Reopen it before completing it again.`);
  }
  if (task.status === "CANCELLED")
    return refuse(`${task.code} is cancelled and cannot be completed.`);
  if (task.status === "NOT_APPLICABLE") {
    return refuse(`${task.code} is marked Not Applicable and cannot be completed.`);
  }
  if (task.confirmationRequired) {
    const missing: string[] = [];
    if (!task.confirmingParty) missing.push("confirming party");
    if (!task.confirmationDate) missing.push("confirmation date");
    if (!task.externalReference) missing.push("external reference");
    if (missing.length > 0) {
      return refuse(
        `${task.code} requires confirmation before completion. Missing: ${missing.join(", ")}.`,
      );
    }
  }
  const byCode = new Map(allTasks.map((t) => [t.code, t]));
  for (const code of task.dependsOnCodes) {
    const dep = byCode.get(code);
    if (!dep || dep.status === "NOT_APPLICABLE") continue;
    if (dep.status !== "COMPLETED") {
      return refuse(
        `${task.code} cannot be completed until ${dep.code} (${dep.name}) is complete. ` +
          `It is currently ${dep.status}.`,
      );
    }
  }
  return allow();
}

/** AC-4.3 / BR-OFF-010: a stage closes only when every BLOCKING task in it is settled. */
export function canCloseStage(stage: JmlStage, tasks: readonly GateTask[]): GateResult {
  const outstanding = tasks.filter((t) => t.stage === stage && t.blocking && OPEN(t.status));
  if (outstanding.length === 0) return allow();
  return refuse(
    `${stage} cannot close: ${outstanding.length} blocking task(s) outstanding — ` +
      outstanding.map((t) => `${t.code} (${t.name}, ${t.status})`).join("; "),
  );
}

/** §6.3: LEAVE stages advance strictly one at a time, never backwards, gated by blocking tasks. */
export function canAdvanceStage(
  from: JmlStage,
  to: JmlStage,
  tasks: readonly GateTask[],
): GateResult {
  const order = STAGE_ORDER.LEAVE;
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return refuse("Only exit-case stages advance this way.");
  if (toIdx === fromIdx) return refuse(`Already at ${from}.`);
  if (toIdx < fromIdx) {
    return refuse(`Stages cannot move backwards (${from} → ${to}); stages are fixed in V1.`);
  }
  if (toIdx > fromIdx + 1) {
    return refuse(
      `Stages advance one at a time (${from} → ${to} skips ${order.slice(fromIdx + 1, toIdx).join(", ")}).`,
    );
  }
  return canCloseStage(from, tasks);
}

/**
 * LEAVE (F4 fixed): the furthest stage the case may stand at — advance from the
 * current stage while each stage's blocking tasks are settled. Never moves back.
 */
export function advancedLeaveStage(current: JmlStage, tasks: readonly GateTask[]): JmlStage {
  const order = STAGE_ORDER.LEAVE;
  let idx = Math.max(0, order.indexOf(current));
  while (idx < order.length - 1 && canCloseStage(order[idx]!, tasks).allowed) idx += 1;
  return order[idx]!;
}
