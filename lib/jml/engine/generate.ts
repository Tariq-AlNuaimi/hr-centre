import type {
  JmlAssigneeRole,
  JmlCaseType,
  JmlComplianceCategory,
  JmlDateBasis,
  JmlOffsetUnit,
  JmlStage,
} from "@/generated/prisma/client";
import { offsetDate, utcDate, type WorkingCalendar } from "@/lib/working-time/calendar";
import { conditionSource, taskApplies, type ConditionFacts } from "./conditions";
import {
  leaveTaskApplies,
  type LeaveApplicability,
  type LeaveProfile,
} from "./leave-applicability";

/**
 * Template → tasks, for every case type (one engine, D6). A case gets a
 * SNAPSHOT at activation, never a live reference to the template (BR-016 /
 * BR-OFF-026).
 *
 * Merges HR Onboarding activation (`dueDateFrom`, conditions, statutory
 * deadlines) and HR Offboarding `task-generation.ts` (bases, working-day
 * offsets, summary-dismissal re-anchoring, dependency pruning, reversals).
 * Every due date comes from `lib/working-time` — the schedule AND public
 * holidays (ADR-077).
 */

export type TemplateTaskDef = LeaveApplicability & {
  code: string;
  name: string;
  stage: JmlStage;
  sortOrder: number;
  dateBasis: JmlDateBasis;
  offsetDays: number;
  offsetUnit: JmlOffsetUnit;
  mandatory: boolean;
  blocking: boolean;
  confirmationRequired: boolean;
  defaultConfirmingParty: string | null;
  reversalFlag: boolean;
  dependsOnCodes: readonly string[];
  statutory: boolean;
  complianceCategory: JmlComplianceCategory | null;
  conditions: unknown;
  /** Task routing — who the task is for (docs/blueprints/jml-task-routing.md). */
  assigneeRole: JmlAssigneeRole;
};

export type Anchors = Partial<Record<JmlDateBasis, Date | null>>;

export type GenerationProfile =
  | { caseType: "JOIN" | "MOVE"; facts: ConditionFacts; anchors: Anchors }
  | { caseType: "LEAVE"; leave: LeaveProfile; anchors: Anchors };

export type GeneratedTask = {
  code: string;
  name: string;
  stage: JmlStage;
  sortOrder: number;
  dateBasis: JmlDateBasis;
  offsetDays: number;
  offsetUnit: JmlOffsetUnit;
  dueDate: Date;
  mandatory: boolean;
  blocking: boolean;
  confirmationRequired: boolean;
  /** F10 fixed: the template's default confirming party is copied onto the task. */
  confirmingParty: string | null;
  reversalFlag: boolean;
  dependsOnCodes: string[];
  statutory: boolean;
  complianceCategory: JmlComplianceCategory | null;
  complianceDeadline: Date | null;
  conditionSource: unknown;
  assigneeRole: JmlAssigneeRole;
};

/** AC-5.1 / BR-OFF-008: summary dismissal re-anchors every Stage 3 task to the decision date. */
function effectiveBasis(def: TemplateTaskDef, profile: GenerationProfile): JmlDateBasis {
  if (
    profile.caseType === "LEAVE" &&
    profile.leave.exitType === "SUMMARY_DISMISSAL" &&
    def.stage === "STAGE_3_NOTICE_HANDOVER"
  ) {
    return "NOTICE_START";
  }
  return def.dateBasis;
}

function applies(def: TemplateTaskDef, profile: GenerationProfile): boolean {
  return profile.caseType === "LEAVE"
    ? leaveTaskApplies(def, profile.leave)
    : taskApplies(def.conditions, profile.facts);
}

/**
 * Generate the task set. Tasks that do not apply are DROPPED; a task whose
 * basis the case does not carry is dropped rather than thrown on; dependencies
 * on codes not generated are pruned.
 */
export function generateTasks(
  templateTasks: readonly TemplateTaskDef[],
  profile: GenerationProfile,
  calendar: WorkingCalendar,
): GeneratedTask[] {
  const out: GeneratedTask[] = [];
  for (const def of templateTasks) {
    if (!applies(def, profile)) continue;
    const basis = effectiveBasis(def, profile);
    const anchor = profile.anchors[basis];
    if (!anchor) continue;
    const dueDate = offsetDate(anchor, def.offsetDays, def.offsetUnit, calendar);
    out.push({
      code: def.code,
      name: def.name,
      stage: def.stage,
      sortOrder: def.sortOrder,
      dateBasis: basis,
      offsetDays: def.offsetDays,
      offsetUnit: def.offsetUnit,
      dueDate,
      mandatory: def.mandatory,
      blocking: def.blocking,
      confirmationRequired: def.confirmationRequired,
      confirmingParty: def.defaultConfirmingParty,
      reversalFlag: def.reversalFlag,
      dependsOnCodes: [...def.dependsOnCodes],
      statutory: def.statutory,
      complianceCategory: def.complianceCategory,
      // Onboarding: a statutory task's compliance deadline is its due date.
      complianceDeadline: def.statutory ? dueDate : null,
      conditionSource: profile.caseType === "LEAVE" ? null : conditionSource(def.conditions),
      assigneeRole: def.assigneeRole,
    });
  }
  const present = new Set(out.map((t) => t.code));
  for (const t of out) t.dependsOnCodes = t.dependsOnCodes.filter((c) => present.has(c));
  return out;
}

export type RecalculableTask = {
  code: string;
  dateBasis: JmlDateBasis | null;
  offsetDays: number | null;
  offsetUnit: JmlOffsetUnit | null;
  dueDate: Date | null;
};

export type DueDateChange = { code: string; from: Date | null; to: Date };

/**
 * AC-3.4 / BR-OFF-004: when an anchor date changes, recalculate ONLY the tasks
 * keyed to it, and report only those whose due date actually moves (a manual
 * override on an untouched basis is preserved).
 */
export function recalculateDueDates(
  tasks: readonly RecalculableTask[],
  before: Anchors,
  after: Anchors,
  calendar: WorkingCalendar,
): DueDateChange[] {
  const changed = new Set<JmlDateBasis>();
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<JmlDateBasis>) {
    if ((before[key]?.getTime() ?? null) !== (after[key]?.getTime() ?? null)) changed.add(key);
  }
  const changes: DueDateChange[] = [];
  for (const t of tasks) {
    if (!t.dateBasis || t.offsetDays === null || !t.offsetUnit || !changed.has(t.dateBasis)) {
      continue;
    }
    const anchor = after[t.dateBasis];
    if (!anchor) continue;
    const next = offsetDate(anchor, t.offsetDays, t.offsetUnit, calendar);
    if (t.dueDate && utcDate(t.dueDate).getTime() === next.getTime()) continue;
    changes.push({ code: t.code, from: t.dueDate, to: next });
  }
  return changes;
}

export type ReversalTask = {
  code: string;
  name: string;
  reversalOfCode: string;
  stage: JmlStage;
};

/**
 * AC-2.3 / BR-OFF-025: on cancellation, one mandatory + blocking reversal task
 * for every COMPLETED task carrying `reversalFlag` (an incomplete revocation
 * never happened, so there is nothing to undo).
 */
export function generateReversalTasks(
  tasks: readonly { code: string; name: string; status: string; reversalFlag: boolean }[],
  caseType: JmlCaseType,
): ReversalTask[] {
  const stage: JmlStage = caseType === "LEAVE" ? "STAGE_3_NOTICE_HANDOVER" : "FIRST_WEEK";
  return tasks
    .filter((t) => t.reversalFlag && t.status === "COMPLETED")
    .map((t) => ({
      code: `REV-${t.code}`,
      name: `Reverse: ${t.name}`,
      reversalOfCode: t.code,
      stage,
    }));
}
