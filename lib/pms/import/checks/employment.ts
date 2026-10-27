import type { EmployeeSourceRow } from "../types";
import type { EmployeeStatus } from "@/generated/prisma/client";
import type { ImportIssue } from "../types";
import { issue, parseIsoDate, type Check } from "./shared";

/**
 * The terms of employment — spec §3.3's compensation and leave fields, §12.1's
 * last working day.
 *
 * Every value here feeds Phase 5's money path (§11.3 multiplies salary by a band
 * coefficient; §11.4 pro-rates over calendar days; §11.5 subtracts unpaid
 * leave), which is why each rejects rather than defaults: a wrong number here
 * surfaces months later as a wrong payment, not as a failed import.
 */

/**
 * §3.3 — basic salary. RESTRICTED (§4.5/§11.6).
 *
 * Note what these messages do NOT do: every other rule quotes the value it
 * rejected, which is right for a name or a department. A salary is Restricted,
 * and an import preview is visible to HRBP and persisted to
 * `ImportBatch.previewJson` — so "4200 is not a valid salary" would route the
 * figure into surfaces the field-level rule keeps it out of. The row number
 * locates the problem instead.
 */
export function checkSalary(row: EmployeeSourceRow): Check<string | null> {
  const raw = row.basicSalary?.trim() ?? "";
  if (!raw) return { value: null, issues: [] };

  const cleaned = raw.replace(/[,\s]/g, "");
  const parsed = Number(cleaned);

  if (!Number.isFinite(parsed)) {
    return {
      value: null,
      issues: [issue(row, "basicSalary", "salary_invalid", "Basic salary is not a valid number.")],
    };
  }
  if (parsed < 0) {
    return {
      value: null,
      issues: [issue(row, "basicSalary", "salary_negative", "Basic salary cannot be negative.")],
    };
  }
  return { value: cleaned, issues: [] };
}

/**
 * §3.4 — "Date of Joining — present and a valid date."
 *
 * REQUIRED, not optional: §3.3 names it "Anchor for 6-month eligibility gate,
 * pro-ration Work Days, and effective service (§11)". A row without it cannot
 * have a bonus computed at all, and §11 refuses rather than guessing — so it is
 * better refused here, on the row, where HR can see which employee to fix.
 */
export function checkDateOfJoining(row: EmployeeSourceRow): Check<Date | null> {
  const raw = row.dateOfJoining?.trim() ?? "";
  if (!raw) {
    return {
      value: null,
      issues: [
        issue(
          row,
          "dateOfJoining",
          "date_of_joining_missing",
          "Date of Joining is required — it anchors the bonus eligibility gate and pro-ration.",
        ),
      ],
    };
  }
  const parsed = parseIsoDate(raw);
  if (!parsed) {
    return {
      value: null,
      issues: [
        issue(
          row,
          "dateOfJoining",
          "date_of_joining_invalid",
          `"${raw}" is not a valid date. Use YYYY-MM-DD.`,
        ),
      ],
    };
  }
  return { value: parsed, issues: [] };
}

/** §3.3 / §12.1 — last working day, required for a leaver (§11.4 pro-ration). */
export function checkLastWorkingDay(
  row: EmployeeSourceRow,
  status: EmployeeStatus,
): Check<Date | null> {
  const issues: ImportIssue[] = [];
  const raw = row.lastWorkingDay?.trim() ?? "";
  let lastWorkingDay: Date | null = null;

  if (raw) {
    lastWorkingDay = parseIsoDate(raw);
    if (!lastWorkingDay) {
      issues.push(
        issue(
          row,
          "lastWorkingDay",
          "last_working_day_invalid",
          `"${raw}" is not a valid date. Use YYYY-MM-DD.`,
        ),
      );
    }
  } else if (status === "LEAVER") {
    // §11.4 pro-rates a leaver "cycle start → last working day". Without the
    // date there is no way to compute their bonus, and the gap would surface as
    // a silently wrong figure in Phase 5 rather than as a problem now.
    issues.push(
      issue(
        row,
        "lastWorkingDay",
        "leaver_without_last_working_day",
        "A leaver must have a last working day — it sets the bonus pro-ration period.",
      ),
    );
  }

  return { value: lastWorkingDay, issues };
}

/** §3.3 / §11.5 — unpaid leave days. */
export function checkUnpaidLeave(row: EmployeeSourceRow): Check<number> {
  const raw = row.unpaidLeaveDays?.trim() ?? "";
  if (!raw) return { value: 0, issues: [] };

  const parsed = Number(raw.replace(/[,\s]/g, ""));
  if (!Number.isInteger(parsed) || parsed < 0) {
    return {
      value: 0,
      issues: [
        issue(
          row,
          "unpaidLeaveDays",
          "unpaid_leave_invalid",
          `"${raw}" is not a valid number of unpaid leave days (whole number, 0 or more).`,
        ),
      ],
    };
  }
  return { value: parsed, issues: [] };
}
