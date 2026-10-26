import type { RoleTrack } from "@/generated/prisma/client";
import type { EmployeeSourceRow, ImportIssue } from "../types";
import { issue, normalize, type Check, type ValidationContext } from "./shared";

/**
 * F-a — the Directorate and Team columns (blueprint §5: "Unknown
 * directorates/teams are reported in the preview, never auto-created").
 *
 * The department still decides placement. The directorate column is a
 * cross-check — a sheet that says "Technology / Data" when Data sits under
 * "Operations" is wrong about something, and the import refuses to guess which.
 * The team must belong to the row's department (AC-F1.2); the database enforces
 * the same with `employees_team_department_agree_fkey`.
 *
 * Returns `teamId: undefined` when the sheet has no Team column, so an import
 * built for Performance leaves teams HR set by hand alone.
 */
export function checkUnits(
  row: EmployeeSourceRow,
  placement: { entityId: string | null; departmentId: string | null },
  roleTrack: RoleTrack | null,
  ctx: ValidationContext,
): Check<{ teamId: string | null | undefined }> {
  const issues: ImportIssue[] = [];
  const directorateRaw = row.directorate?.trim() ?? "";
  const teamRaw = row.team?.trim() ?? "";
  const teamId: string | null | undefined = row.team === undefined ? undefined : null;

  if (roleTrack === "C_LEVEL") {
    if (directorateRaw) {
      issues.push(
        issue(row, "directorate", "c_level_has_directorate", cLevelMessage("directorate")),
      );
    }
    if (teamRaw) issues.push(issue(row, "team", "c_level_has_team", cLevelMessage("team")));
    return { value: { teamId }, issues };
  }

  // No resolved department: its own check already rejected the row, and
  // anything said about directorate or team would be a guess.
  const { departmentId, entityId } = placement;
  if (!departmentId || !entityId) return { value: { teamId }, issues };

  if (directorateRaw) {
    const problem = directorateProblem(directorateRaw, departmentId, entityId, ctx);
    if (problem) issues.push(issue(row, "directorate", problem.rule, problem.message));
  }

  if (!teamRaw) return { value: { teamId }, issues };
  const found = ctx.teamsByDepartmentAndName?.get(`${departmentId}::${normalize(teamRaw)}`);
  if (!found) {
    issues.push(
      issue(
        row,
        "team",
        "team_unknown",
        `"${teamRaw}" is not a team of ${row.department?.trim() ?? "this department"}. ` +
          `Create it in Organisation first — imports never create teams.`,
      ),
    );
    return { value: { teamId }, issues };
  }
  return { value: { teamId: found }, issues };
}

function cLevelMessage(unit: "directorate" | "team"): string {
  return `C-Level employees are tagged to a company directly, so they have no ${unit}.`;
}

function directorateProblem(
  directorateRaw: string,
  departmentId: string,
  entityId: string,
  ctx: ValidationContext,
): { rule: string; message: string } | null {
  const key = normalize(directorateRaw);
  if (!ctx.directorateKeys?.has(`${entityId}::${key}`)) {
    return {
      rule: "directorate_unknown",
      message:
        `"${directorateRaw}" is not a directorate of this company. ` +
        `Create it in Organisation first — imports never create directorates.`,
    };
  }
  const actual = ctx.departmentDirectorates?.get(departmentId) ?? null;
  if (actual?.key === key) return null;
  return {
    rule: "directorate_mismatch",
    message: actual
      ? `This department sits under the "${actual.name}" directorate, not "${directorateRaw}". ` +
        `Correct the sheet, or move the department in Organisation.`
      : `This department sits directly under its company, not under "${directorateRaw}". ` +
        `Correct the sheet, or move the department in Organisation.`,
  };
}
