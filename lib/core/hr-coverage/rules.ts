import type { HrCoverageLevel } from "@/generated/prisma/client";
import type { HrCoverageInput } from "@/lib/validations/core/hr-coverage";

/**
 * "Who is my HR" (ADR-102) — the pure rules of the core HR coverage model.
 *
 * A coverage row names one unit: a company, a directorate, a department or a
 * team (its `level` is the most specific one it names). JML assigns a case by
 * the most specific level that has a live row for the person's placement —
 * department, then directorate, then company — then priority (high first),
 * then the oldest row. HR tickets match rows by words and the company-wide
 * flag (lib/hive/hrtag-routing.ts); both read the same rows.
 */

export type Placement = {
  entityId: string;
  directorateId: string | null;
  departmentId: string | null;
};

/** Case assignment precedence, most specific first. */
export const CASE_LEVEL_PRECEDENCE = ["DEPARTMENT", "DIRECTORATE", "COMPANY"] as const;
export type CaseLevel = (typeof CASE_LEVEL_PRECEDENCE)[number];

/** The rungs a placement has, most specific first, as `where` fragments. */
export function caseRungs(
  p: Placement,
): Array<{ level: CaseLevel; where: Record<string, string | CaseLevel> }> {
  return [
    ...(p.departmentId
      ? [
          {
            level: "DEPARTMENT" as const,
            where: { level: "DEPARTMENT", departmentId: p.departmentId },
          },
        ]
      : []),
    ...(p.directorateId
      ? [
          {
            level: "DIRECTORATE" as const,
            where: { level: "DIRECTORATE", directorateId: p.directorateId },
          },
        ]
      : []),
    { level: "COMPANY" as const, where: { level: "COMPANY", entityId: p.entityId } },
  ];
}

/**
 * The level a row stands for: the whole company when it routes a company
 * wholesale, else the most specific unit it names (the order the ticket
 * selector reads), else none (a row matched by words only).
 */
export function levelOf(row: {
  companyWide?: boolean;
  entityId: string | null;
  directorateId: string | null;
  departmentId: string | null;
  teamId?: string | null;
}): HrCoverageLevel | null {
  if (row.companyWide) return "COMPANY";
  if (row.teamId) return "TEAM";
  if (row.departmentId) return "DEPARTMENT";
  if (row.directorateId) return "DIRECTORATE";
  return row.entityId ? "COMPANY" : null;
}

/** The unit id a row's level names (what JML calls the rule's scope id). */
export function unitIdOf(row: {
  level: HrCoverageLevel | null;
  entityId: string | null;
  directorateId: string | null;
  departmentId: string | null;
  teamId?: string | null;
}): string | null {
  switch (row.level) {
    case "TEAM":
      return row.teamId ?? null;
    case "DEPARTMENT":
      return row.departmentId;
    case "DIRECTORATE":
      return row.directorateId;
    case "COMPANY":
      return row.entityId;
    default:
      return null;
  }
}

/** The fields of a stored row the permission check compares. */
type CoverageFields = {
  entityId: string | null;
  directorateId: string | null;
  departmentId: string | null;
  teamId: string | null;
  active: boolean;
  pairId: string | null;
  label: string;
  aliases: string[];
  companyWide: boolean;
  ownerUserId: string | null;
  supervisorUserId: string | null;
  caseTypes: string[];
  priority: number;
};

export const hasTicketHalf = (r: { pairId: string | null }) => Boolean(r.pairId);
export const hasCaseHalf = (r: { ownerUserId: string | null }) => Boolean(r.ownerUserId);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Which halves a change touches, so the right permission is asked for. */
export function halvesTouched(before: CoverageFields | null, after: HrCoverageInput) {
  // A new row asks for the halves it has.
  if (!before) return { tickets: hasTicketHalf(after), jml: hasCaseHalf(after) };
  const was = (k: keyof HrCoverageInput) => (before as unknown as Record<string, unknown>)[k];
  const changed = (keys: (keyof HrCoverageInput)[]) => keys.some((k) => !same(was(k), after[k]));
  const shared = changed(["entityId", "directorateId", "departmentId", "teamId", "active"]);
  return {
    tickets:
      changed(["pairId", "label", "aliases", "companyWide"]) ||
      (shared && (hasTicketHalf(after) || hasTicketHalf(before))),
    jml:
      changed(["ownerUserId", "supervisorUserId", "caseTypes", "priority"]) ||
      (shared && (hasCaseHalf(after) || hasCaseHalf(before))),
  };
}
