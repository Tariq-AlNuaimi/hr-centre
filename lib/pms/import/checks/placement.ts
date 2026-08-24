import type { EmployeeSourceRow } from "../types";
import type { RoleTrack } from "@/generated/prisma/client";
import type { ImportIssue } from "../types";
import { issue, normalize, type Check, type ValidationContext } from "./shared";

/**
 * Where this row puts the person in the organization — spec §1.2 (entity /
 * department, and the C-Level exclusive-or) and §3.4's department and manager
 * rules.
 *
 * These are the checks that need CONTEXT: a department is only valid if it
 * exists, and a manager is only valid if they exist somewhere — in the database
 * or elsewhere in the same file. That is also why they carry the most branching
 * in the import layer, and why they live apart from the context-free identity
 * checks.
 */

/**
 * §1.2 + §3.4 — entity and department placement, including the C-Level
 * exclusive-or and the "department must be recognized" rule.
 */
export function checkPlacement(
  row: EmployeeSourceRow,
  roleTrack: RoleTrack | null,
  ctx: ValidationContext,
): Check<{ entityId: string | null; departmentId: string | null }> {
  const issues: ImportIssue[] = [];
  const entityRaw = row.entity?.trim() ?? "";
  const departmentRaw = row.department?.trim() ?? "";
  let entityId: string | null = null;
  let departmentId: string | null = null;

  const entityMatch = entityRaw ? ctx.entitiesByKey.get(normalize(entityRaw)) : undefined;
  if (entityRaw && !entityMatch) {
    issues.push(
      issue(
        row,
        "entity",
        "entity_unknown",
        `"${entityRaw}" is not a known entity. Set the entity up first, or correct the spelling.`,
      ),
    );
  }

  if (roleTrack === "C_LEVEL") {
    // §1.2 — "C-Level employees are the exception: they are tagged to an entity
    // directly, with no department."
    if (departmentRaw) {
      issues.push(
        issue(
          row,
          "department",
          "c_level_has_department",
          `C-Level employees are tagged to an entity directly and must not have a department ` +
            `(found "${departmentRaw}").`,
        ),
      );
    }
    if (!entityRaw) {
      issues.push(
        issue(
          row,
          "entity",
          "c_level_entity_missing",
          "C-Level employees must name their entity, since they have no department to imply it.",
        ),
      );
    } else if (entityMatch) {
      entityId = entityMatch.id;
    }
    return { value: { entityId, departmentId }, issues };
  }

  if (!roleTrack) return { value: { entityId, departmentId }, issues };

  // Non-C-Level: a department is mandatory and implies the entity (§1.2).
  if (!departmentRaw) {
    issues.push(
      issue(
        row,
        "department",
        "department_missing",
        "Department is required for every track except C-Level.",
      ),
    );
    return { value: { entityId, departmentId }, issues };
  }

  const deptKey = normalize(departmentRaw);

  if (entityMatch) {
    // Entity given: the (entity, department) pair must exist. The unambiguous
    // path, and the one the template encourages — §1.2 makes "Sales" alone a
    // genuinely ambiguous name across three entities.
    const dept = ctx.departmentsByEntityAndName.get(`${entityMatch.code}::${deptKey}`);
    if (!dept) {
      issues.push(
        issue(
          row,
          "department",
          "department_unknown",
          `"${departmentRaw}" is not a department of ${entityMatch.code}. ` +
            `Create it in org setup first — imports never create departments.`,
        ),
      );
    } else {
      departmentId = dept.id;
      entityId = dept.entityId;
    }
    return { value: { entityId, departmentId }, issues };
  }

  if (entityRaw) {
    // Entity was given but is unknown — already reported. A department lookup
    // here would only produce a second, confusing error for one root cause.
    return { value: { entityId, departmentId }, issues };
  }

  // No entity column: fall back to the name alone, but ONLY when unambiguous.
  // §1.2's own example ("Rihal Marketing", "TP Sales", "CL Sales" are distinct)
  // is exactly the case where guessing files someone under the wrong entity —
  // and entity drives their Corporate score (§8.4), so the error would surface
  // as a wrong number months later rather than a failed import today.
  const matches = ctx.departmentsByName.get(deptKey) ?? [];
  if (matches.length === 0) {
    issues.push(
      issue(
        row,
        "department",
        "department_unknown",
        `"${departmentRaw}" is not a known department. Create it in org setup first — ` +
          `imports never create departments.`,
      ),
    );
  } else if (matches.length > 1) {
    issues.push(
      issue(
        row,
        "department",
        "department_ambiguous",
        `"${departmentRaw}" exists in more than one entity ` +
          `(${matches.map((m) => m.entityCode).join(", ")}). ` +
          `Add an Entity column so each row says which one it means.`,
      ),
    );
  } else {
    departmentId = matches[0].id;
    entityId = matches[0].entityId;
  }

  return { value: { entityId, departmentId }, issues };
}

/**
 * §3.4 — "Manager — valid Employee ID; required for all tracks except C-Level
 * (blank allowed only for C-Level)".
 *
 * A manager may be an existing employee OR another row further down the same
 * file: an org sheet is sorted by name or department, never topologically.
 */
export function checkManager(
  row: EmployeeSourceRow,
  odooId: string,
  roleTrack: RoleTrack | null,
  idsInFile: Set<string>,
  ctx: ValidationContext,
): Check<string | null> {
  const managerOdooId = row.managerOdooId?.trim() || null;

  if (!managerOdooId) {
    if (roleTrack && roleTrack !== "C_LEVEL") {
      return {
        value: null,
        issues: [
          issue(
            row,
            "managerOdooId",
            "manager_missing",
            "A manager is required for every track except C-Level.",
          ),
        ],
      };
    }
    return { value: null, issues: [] };
  }

  if (managerOdooId === odooId) {
    return {
      value: managerOdooId,
      issues: [
        issue(row, "managerOdooId", "manager_self", "An employee cannot be their own manager."),
      ],
    };
  }

  if (!idsInFile.has(managerOdooId) && !ctx.existingOdooIds.has(managerOdooId)) {
    return {
      value: managerOdooId,
      issues: [
        issue(
          row,
          "managerOdooId",
          "manager_unknown",
          `Manager "${managerOdooId}" is not an employee in this file or already in the system.`,
        ),
      ],
    };
  }

  return { value: managerOdooId, issues: [] };
}
