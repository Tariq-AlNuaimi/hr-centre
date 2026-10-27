/**
 * Historical exit import (§26.2, HR Offboarding `scripts/import-historical-exits.mjs`),
 * the pure half: CSV parsing (RFC 4180 as spreadsheets export it — BOM,
 * quotes, doubled quotes, embedded commas/newlines) and per-row validation.
 * A missing required column refuses the whole file (no partial loads); bad
 * rows are reported per line; a reference twice in the file names both lines.
 * On the core record the employee is matched by Odoo id or EMP code, so the
 * name/company/department columns of the source are not needed.
 */

import { parseCsv } from "./csv";

export { parseCsv };

export const REQUIRED_COLUMNS = [
  "caseRef",
  "employeeExternalId",
  "exitType",
  "nationality",
  "noticeStartDate",
  "lastDayOfService",
] as const;
export const OPTIONAL_COLUMNS = [
  "lastPhysicalWorkingDay",
  "primaryL1",
  "primaryL2Code",
  "secondaryL2Code",
  "closedAt",
] as const;

const EXIT_TYPES = new Set([
  "RESIGNATION",
  "TERMINATION",
  "CONTRACT_EXPIRY",
  "PROBATION_EXIT",
  "SUMMARY_DISMISSAL",
]);
const NATIONALITIES = new Set(["OMANI", "EXPATRIATE"]);

export type ImportRow = {
  line: number;
  caseRef: string;
  employeeExternalId: string;
  exitType: string;
  nationality: string;
  noticeStartDate: Date;
  lastPhysicalWorkingDay: Date;
  lastDayOfService: Date;
  primaryL1: string | null;
  primaryL2Code: string | null;
  secondaryL2Code: string | null;
  closedAt: Date | null;
};

export type RowProblem = { line: number; caseRef: string | null; message: string };

function parseDate(value: string | undefined): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}

function parseDates(get: (c: string) => string, today: Date) {
  const p: string[] = [];
  const ns = parseDate(get("noticeStartDate"));
  const lds = parseDate(get("lastDayOfService"));
  const lpwdRaw = get("lastPhysicalWorkingDay");
  const lpwd = lpwdRaw ? parseDate(lpwdRaw) : lds;
  const closedRaw = get("closedAt");
  const closedAt = closedRaw ? parseDate(closedRaw) : null;
  const bad = (raw: string, parsed: Date | null, name: string) => {
    if (raw && !parsed) p.push(`${name} is not a YYYY-MM-DD date`);
  };
  bad(get("noticeStartDate"), ns, "noticeStartDate");
  bad(get("lastDayOfService"), lds, "lastDayOfService");
  bad(lpwdRaw, lpwd, "lastPhysicalWorkingDay");
  bad(closedRaw, closedAt, "closedAt");
  if (lds && lds >= today)
    p.push(
      "lastDayOfService is not in the past — an exit still in flight is RE-KEYED, not imported",
    );
  if (ns && lpwd && lpwd < ns) p.push("lastPhysicalWorkingDay is before noticeStartDate");
  if (lpwd && lds && lds < lpwd) p.push("lastDayOfService is before lastPhysicalWorkingDay");
  return { ns, lds, lpwd, closedAt, problems: p };
}

function valueProblems(get: (c: string) => string): string[] {
  const p: string[] = [];
  for (const c of REQUIRED_COLUMNS) if (!get(c)) p.push(`${c} is empty`);
  const exitType = get("exitType").toUpperCase();
  const nationality = get("nationality").toUpperCase();
  if (exitType && !EXIT_TYPES.has(exitType))
    p.push(`exitType "${exitType}" is not one of ${[...EXIT_TYPES].join(", ")}`);
  if (nationality && !NATIONALITIES.has(nationality))
    p.push("nationality must be OMANI or EXPATRIATE");
  if (get("primaryL2Code") && !get("primaryL1")) p.push("primaryL2Code needs its primaryL1");
  return p;
}

function rowProblems(
  get: (c: string) => string,
  line: number,
  today: Date,
): { row: ImportRow | null; problems: string[] } {
  const dates = parseDates(get, today);
  const p = [...valueProblems(get), ...dates.problems];
  if (p.length || !dates.ns || !dates.lds || !dates.lpwd) return { row: null, problems: p };
  const upper = (c: string) => get(c).toUpperCase() || null;
  return {
    row: {
      line,
      caseRef: get("caseRef"),
      employeeExternalId: get("employeeExternalId"),
      exitType: get("exitType").toUpperCase(),
      nationality: get("nationality").toUpperCase(),
      noticeStartDate: dates.ns,
      lastPhysicalWorkingDay: dates.lpwd,
      lastDayOfService: dates.lds,
      primaryL1: upper("primaryL1"),
      primaryL2Code: upper("primaryL2Code"),
      secondaryL2Code: upper("secondaryL2Code"),
      closedAt: dates.closedAt,
    },
    problems: [],
  };
}

export function validateImport(
  text: string,
  today: Date,
): { rows: ImportRow[]; problems: RowProblem[]; fatal: string | null } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], problems: [], fatal: "The file has no data rows." };
  const header = table[0]!.map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length)
    return {
      rows: [],
      problems: [],
      fatal: `Missing required column(s): ${missing.join(", ")}. Nothing was read.`,
    };
  if (table.length - 1 > 5000)
    return { rows: [], problems: [], fatal: "At most 5,000 rows per file." };
  const rows: ImportRow[] = [];
  const problems: RowProblem[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (c: string) => (cells[header.indexOf(c)] ?? "").trim();
    const ref = get("caseRef") || null;
    if (ref && seen.has(ref)) {
      problems.push({
        line,
        caseRef: ref,
        message: `caseRef ${ref} also appears on line ${seen.get(ref)}`,
      });
      return;
    }
    if (ref) seen.set(ref, line);
    const r = rowProblems(get, line, today);
    if (r.row) rows.push(r.row);
    else problems.push({ line, caseRef: ref, message: r.problems.join("; ") });
  });
  return { rows, problems, fatal: null };
}
