/**
 * Dashboard rules, pure (Offboarding `dashboard.ts`, AC-13.1; Onboarding's
 * dashboard). "My work" buckets an open task by its due date against today in
 * the schedule's zone.
 */

export type WorkBucket = "OVERDUE" | "DUE_TODAY" | "DUE_TOMORROW" | "FUTURE" | "NO_DATE";

export function workBucket(due: Date | null, today: Date): WorkBucket {
  if (!due) return "NO_DATE";
  const day = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (day < t) return "OVERDUE";
  if (day === t) return "DUE_TODAY";
  if (day === t + 86_400_000) return "DUE_TOMORROW";
  return "FUTURE";
}

export const BUCKET_ORDER: Record<WorkBucket, number> = {
  OVERDUE: 0,
  DUE_TODAY: 1,
  DUE_TOMORROW: 2,
  FUTURE: 3,
  NO_DATE: 4,
};

/** AC-13.5: by default a case owner sees their own cases; a supervisor sees everything in scope. */
export function defaultMine(supervises: boolean, requested: "mine" | "all" | undefined): boolean {
  if (requested) return requested === "mine";
  return !supervises;
}
