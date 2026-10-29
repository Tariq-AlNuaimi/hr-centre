import type { JmlAssigneeRole, JmlTaskDesk } from "@/generated/prisma/client";

/**
 * JML task routing — the pure rules (docs/blueprints/jml-task-routing.md).
 *
 *  - HR tasks are owned by the case's HR owner (unchanged).
 *  - IT / FINANCE tasks belong to the named DESK as a group: owner null, any
 *    listed person may complete it, `completedBy` records who did. An empty desk
 *    falls back to the HR owner and the case shows a setup warning.
 *  - LINE_MANAGER tasks are owned by the employee's CURRENT line manager's login
 *    (Employee.managerId → that employee's User); none → HR owner + warning.
 *
 * Authority for a non-HR worker is DERIVED, never assigned (the Performance
 * rule, lib/core/permissions.ts): desk membership for IT / FINANCE tasks, the
 * manager edge for LINE_MANAGER tasks. It covers those tasks only — never the
 * rest of the case, and never settlement or other Restricted data.
 */

export const TASK_DESKS = ["IT", "FINANCE"] as const;

/** The desk a role is routed to, or null for HR / LINE_MANAGER. */
export function deskOf(role: JmlAssigneeRole): JmlTaskDesk | null {
  return role === "IT" || role === "FINANCE" ? role : null;
}

export type RoutingContext = {
  hrOwnerUserId: string | null;
  /** The login of the employee's current line manager, if they have one. */
  lineManagerUserId: string | null;
  /** Desks with at least one listed (active) person. */
  staffedDesks: ReadonlySet<JmlTaskDesk>;
};

/** Who owns a task of `role` when it is generated (or re-routed). */
export function resolveTaskOwner(role: JmlAssigneeRole, ctx: RoutingContext): string | null {
  if (role === "LINE_MANAGER") return ctx.lineManagerUserId ?? ctx.hrOwnerUserId;
  const desk = deskOf(role);
  if (desk) return ctx.staffedDesks.has(desk) ? null : ctx.hrOwnerUserId;
  return ctx.hrOwnerUserId;
}

export type RoutingWarning = "IT_DESK_EMPTY" | "FINANCE_DESK_EMPTY" | "NO_LINE_MANAGER";

/**
 * The setup warnings a case shows: an open task whose route has nobody to go
 * to, so the HR owner is holding it. Computed live, so configuring the desk or
 * the manager clears it.
 */
export function routingWarnings(
  openRoles: Iterable<JmlAssigneeRole>,
  ctx: Pick<RoutingContext, "lineManagerUserId" | "staffedDesks">,
): RoutingWarning[] {
  const roles = new Set(openRoles);
  const out: RoutingWarning[] = [];
  if (roles.has("IT") && !ctx.staffedDesks.has("IT")) out.push("IT_DESK_EMPTY");
  if (roles.has("FINANCE") && !ctx.staffedDesks.has("FINANCE")) out.push("FINANCE_DESK_EMPTY");
  if (roles.has("LINE_MANAGER") && !ctx.lineManagerUserId) out.push("NO_LINE_MANAGER");
  return out;
}

export type WorkerFacts = {
  /** Desks the actor is listed on. */
  desks: ReadonlySet<JmlTaskDesk>;
  /** The actor's own employee record, if linked. */
  employeeId: string | null;
};

/**
 * May a non-HR actor work this task by derived authority? A desk member works
 * their desk's tasks; the employee's direct line manager works the
 * LINE_MANAGER tasks. HR tasks never.
 */
export function workerMayWork(
  worker: WorkerFacts,
  task: { assigneeRole: JmlAssigneeRole },
  employee: { managerId: string | null },
): boolean {
  const desk = deskOf(task.assigneeRole);
  if (desk) return worker.desks.has(desk);
  if (task.assigneeRole === "LINE_MANAGER") {
    return worker.employeeId !== null && employee.managerId === worker.employeeId;
  }
  return false;
}

/** The task fields a derived worker may set — the work itself, not its planning. */
const WORKER_FIELDS = new Set([
  "status",
  "delayReason",
  "externalReference",
  "confirmingParty",
  "confirmationDate",
  "expectedVersion",
]);

/**
 * Why a derived worker may not make this change, or null. They complete,
 * progress and delay their task and record its reference; owner, due date and
 * "not applicable" are HR's calls, and re-opening a completed task is too.
 */
export function workerChangeProblem(
  input: Record<string, unknown>,
  currentStatus: string,
): string | null {
  const extra = Object.keys(input).filter((k) => input[k] !== undefined && !WORKER_FIELDS.has(k));
  if (extra.length > 0) {
    return "Only HR can change a task's owner, due date or other planning.";
  }
  if (input.status === "NOT_APPLICABLE" || input.status === "CANCELLED") {
    return "Only HR can mark a task not applicable.";
  }
  if (
    input.status !== undefined &&
    input.status !== currentStatus &&
    currentStatus === "COMPLETED"
  ) {
    return "Only HR can re-open a completed task.";
  }
  return null;
}
