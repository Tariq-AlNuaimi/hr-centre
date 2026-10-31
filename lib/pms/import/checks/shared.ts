import type { CatalogueGrade } from "@/lib/core/catalogue/grades";
import type { EmployeeStatus, RoleTrack } from "@/generated/prisma/client";
import type { ImportIssue } from "../types";

/**
 * Shared vocabulary for the per-field import checks — spec §1.3, §3.3, §3.4.
 *
 * Split out of validate.ts so each check is one spec bullet: it takes a source
 * row, returns the value it resolved plus any issues it raised, and can be read
 * — and tested — without constructing a whole batch. `validate.ts` then reads as
 * the list of rules the spec actually states, and the two batch-level rules that
 * genuinely need the whole file (ID uniqueness, cycle detection) stay there.
 *
 * Two commitments hold across every check in this file:
 *
 * 1. **Failures are collected, never thrown.** A row breaking four rules yields
 *    four issues and is rejected once, so HR fixes the sheet in one pass.
 *
 * 2. **Nothing is coerced into validity.** An unrecognised department is
 *    rejected, not created; a malformed date is rejected, not defaulted. §3.4's
 *    "never silently accepted" is a rule about what the system may decide on
 *    HR's behalf, and the answer is: nothing.
 */

/** §1.3 — the five tracks, keyed by the spellings a human might type. */
export const ROLE_TRACK_ALIASES: Record<string, RoleTrack> = {
  "c level": "C_LEVEL",
  "c-level": "C_LEVEL",
  clevel: "C_LEVEL",
  c_level: "C_LEVEL",
  director: "DIRECTOR",
  manager: "MANAGER",
  lead: "LEAD",
  individual: "INDIVIDUAL",
  "individual contributor": "INDIVIDUAL",
};

/** §3.3 — Active / Leaver. */
export const STATUS_ALIASES: Record<string, EmployeeStatus> = {
  active: "ACTIVE",
  leaver: "LEAVER",
  left: "LEAVER",
  terminated: "LEAVER",
  inactive: "LEAVER",
};

export function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/** Context the checks need about what already exists in the database. */
export type ValidationContext = {
  /** Department lookup by (entityCode, normalised department name) → id. */
  departmentsByEntityAndName: Map<string, { id: string; entityId: string }>;
  /** Department lookup by normalised name alone, for sheets that omit entity. */
  departmentsByName: Map<string, Array<{ id: string; entityId: string; entityCode: string }>>;
  /** Entity lookup by normalised code or name → { id, code }. */
  entitiesByKey: Map<string, { id: string; code: string }>;
  /** Odoo IDs already in the employees table — a manager may be an existing row. */
  existingOdooIds: Set<string>;
  /**
   * Normalised email → the odooId of the employee who already holds it.
   *
   * `Employee.email` is `@unique` in the schema, so a row claiming an address
   * that belongs to a DIFFERENT employee cannot be written. Without this map the
   * collision is invisible until apply, where it surfaces as a raw constraint
   * violation inside the batch transaction and rolls back every other row —
   * after a preview that reported no rejections. See validate.ts.
   */
  emailOwners: Map<string, string>;
  /**
   * F-a lookups. Optional so a context built for the Performance-era columns
   * still type-checks; absent maps mean "nothing known", which rejects any
   * directorate or team the sheet names rather than accepting it unchecked.
   */
  /** `${entityId}::${normalized name}` for every directorate. */
  directorateKeys?: Set<string>;
  /** departmentId → its directorate (normalized key + display name), or null. */
  departmentDirectorates?: Map<string, { key: string; name: string } | null>;
  /** `${departmentId}::${normalized team name}` → teamId. */
  teamsByDepartmentAndName?: Map<string, string>;
  /**
   * ADR-103 — the live grade catalogue (codes only). Absent means "nothing
   * known": any grade the sheet names is refused rather than accepted unchecked.
   */
  grades?: CatalogueGrade[];
};

export function issue(
  row: { rowNumber: number; odooId: string | null },
  field: ImportIssue["field"],
  rule: string,
  message: string,
  severity: ImportIssue["severity"] = "REJECT",
): ImportIssue {
  return { rowNumber: row.rowNumber, odooId: row.odooId, field, rule, message, severity };
}

export type Check<T> = { issues: ImportIssue[]; value: T };

/**
 * Strict `YYYY-MM-DD` parse.
 *
 * Deliberately NOT `new Date(str)`: that accepts "next tuesday"-grade garbage
 * inconsistently across runtimes and silently applies a timezone offset, which
 * for a date used in a ÷365 day count (§11.4) can shift the result by a day.
 * Constructing from UTC parts keeps the calendar day exactly as typed.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 2026-02-30, which Date.UTC would roll forward to 2026-03-02.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  if (date.getUTCDate() !== day) return null;
  return date;
}
