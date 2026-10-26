import { toReportSheet, buildReportWorkbook } from "@/lib/pms/export/xlsx";
import type { ReportFilters } from "@/lib/validations/jml/report";
import type { JmlActor } from "../access";
import { JmlError } from "../errors";
import { allCompanies, hrWorkload, volumeTrend } from "./join-aggregate";
import type { ReportDefinition, ReportRow } from "./join-base";
import { goLiveDate } from "./join-base";
import {
  completedOnboardings,
  delayedTasks,
  monthlyOnboarding,
  onboardingCompletion,
  upcomingJoiners,
} from "./join-cases";

/**
 * The JML report registry. Onboarding §13.1 — exactly these eight, in this
 * order (a contract test pins it). The leaver reports (R1–R8) join in S6.
 */
export const REPORTS: readonly ReportDefinition[] = [
  monthlyOnboarding,
  hrWorkload,
  onboardingCompletion,
  delayedTasks,
  upcomingJoiners,
  completedOnboardings,
  volumeTrend,
  allCompanies,
];

export function findReport(slug: string): ReportDefinition {
  const report = REPORTS.find((r) => r.slug === slug);
  if (!report) throw new JmlError("Report not found", 404);
  return report;
}

export async function runReport(actor: JmlActor, slug: string, filters: ReportFilters) {
  const report = findReport(slug);
  const includeSalary = report.salaryCapable && filters.includeSalary;
  const rows = await report.run({ actor, filters: { ...filters, includeSalary }, now: new Date() });
  return {
    slug,
    salaryCapable: report.salaryCapable,
    includeSalary,
    columns: report.columns(includeSalary),
    rows,
    truncated: rows.length >= 5000,
    goLive: slug === "onboarding-volume-trend" ? await goLiveDate() : null,
  };
}

export async function exportReport(actor: JmlActor, slug: string, filters: ReportFilters) {
  const result = await runReport(actor, slug, filters);
  return buildReportWorkbook([
    toReportSheet<ReportRow>({
      sheet: slug.slice(0, 31),
      columns: result.columns.map((c) => ({
        title: c.title,
        width: c.width,
        value: (row) => {
          const v = row[c.key];
          return v === null || v === undefined
            ? null
            : typeof v === "boolean"
              ? v
                ? "Yes"
                : "No"
              : v;
        },
      })),
      rows: result.rows,
    }),
  ]);
}
