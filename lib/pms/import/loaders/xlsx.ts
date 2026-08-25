import readXlsxFile from "read-excel-file/node";
import {
  COLUMN_ALIASES,
  IMPORT_COLUMNS,
  type EmployeeSourceRow,
  type ImportColumn,
} from "../types";

/**
 * Excel loader — spec §3.1 ("v1: Employee and org data is loaded via Excel
 * import"), loader #1 behind the import layer's `EmployeeSourceRow` boundary.
 *
 * This file is the ONLY place in the codebase that imports an Excel library
 * (ADR-066). Everything downstream speaks `EmployeeSourceRow`, so replacing the
 * engine — or adding the v2 Odoo loader — touches this file and nothing else.
 *
 * Its job is narrow on purpose: turn a workbook into rows of trimmed strings,
 * and refuse a file that is structurally unusable. It makes NO judgement about
 * whether a value is a valid role track, a known department, or a resolvable
 * manager — those are §3.4 rules and they live in validate.ts, where a failure
 * becomes a reported rejection instead of a thrown error.
 */

/**
 * Untrusted-input bounds, enforced BEFORE the parser sees the bytes.
 *
 * An HR user uploads an arbitrary `.xlsx`, which is a zip of XML — the classic
 * decompression-bomb shape. `read-excel-file` is maintained and registry-tracked
 * (ADR-066), but the mitigation that does not depend on the parser being
 * flawless is refusing an implausible file at the door.
 *
 * The numbers are sized against the actual organization (three entities; the
 * spec's own examples imply hundreds of employees, not hundreds of thousands)
 * with a generous multiple for growth.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_ROWS = 10_000;
export const MAX_SHEETS = 20;

/**
 * The sheet the loader looks for by name before falling back to the first one.
 * Matches the tab the generated template creates (lib/pms/export/xlsx.ts), so a
 * template-derived workbook is read from the right tab even when HR has added
 * their own notes or pivot tabs alongside it.
 */
const PREFERRED_SHEET_NAME = "employees";

export class ImportFileError extends Error {
  readonly rule: string;
  constructor(rule: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ImportFileError";
    this.rule = rule;
  }
}

/**
 * Normalised form used to match a header cell against COLUMN_ALIASES.
 *
 * Punctuation is dropped, not just whitespace and separators: real HR headers
 * carry parenthetical hints — the generated template's own
 * "Manager (Employee ID)" among them — and a matcher that only folded case and
 * spaces would fail to recognise the very file this system hands out.
 */
function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Cell → trimmed string, or null for genuinely empty.
 *
 * Two cases earn special handling because Excel silently changes what HR typed:
 *
 *  - **Dates.** A date-formatted cell arrives as a `Date`, and
 *    `String(new Date())` yields a locale-dependent, timezone-shifted string.
 *    Emitting ISO `yyyy-mm-dd` from the date's UTC parts keeps "last working
 *    day" the calendar day HR entered. §11.4 counts days against a 365-day
 *    year, so a one-day timezone slip is a real money error, not a cosmetic one.
 *
 *  - **Numbers.** An employee ID typed as `12345` arrives as the number 12345,
 *    and a salary as a float. `String()` is right for both, but a float that
 *    Excel stores as `4200.0000000001` must not become an ID or a salary
 *    string with noise on the end, so integral values are emitted without a
 *    decimal tail.
 */
function cellToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
  }

  if (typeof value === "boolean") return String(value);

  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export type HeaderMap = Partial<Record<ImportColumn, number>>;

/**
 * Map the header row onto canonical fields. Unrecognised columns are IGNORED
 * rather than rejected: HR exports routinely carry extra columns (cost centre,
 * grade, joining date) that this system has no opinion about in Phase 1, and
 * failing an otherwise-good file because it has a spare column would be a
 * pointless obstacle.
 *
 * A DUPLICATE mapping is a different matter and is refused: if a sheet has both
 * "Employee ID" and "Odoo ID", the loader cannot know which one HR means, and
 * guessing would silently key the entire import off the wrong column — the one
 * mistake §3.2 says must never happen.
 */
export function mapHeaders(headerRow: unknown[]): HeaderMap {
  const map: HeaderMap = {};
  const seen = new Map<ImportColumn, string>();

  headerRow.forEach((raw, index) => {
    const header = normalizeHeader(raw);
    if (!header) return;

    for (const column of IMPORT_COLUMNS) {
      if (!COLUMN_ALIASES[column].includes(header)) continue;

      const previous = seen.get(column);
      if (previous !== undefined) {
        throw new ImportFileError(
          "duplicate_column",
          `Two columns both map to "${column}": "${previous}" and "${header}". ` +
            `Remove or rename one so the import knows which to use.`,
        );
      }
      seen.set(column, header);
      map[column] = index;
      return;
    }
  });

  return map;
}

/**
 * The columns without which an import cannot be attempted at all.
 *
 * Deliberately shorter than §3.4's rule list. §3.4 governs whether a ROW is
 * acceptable and reports each failure against that row; this governs whether
 * the FILE has enough structure to produce rows in the first place. Without an
 * ID column there is no key to reconcile on (§3.2) and every row would reject
 * for the same reason — a file-level error reported once is more useful than
 * ten thousand identical row errors.
 *
 * `entity` is absent on purpose: §1.2 makes entity derivable from department for
 * everyone except C-Level, so a sheet may legitimately omit it.
 */
const REQUIRED_COLUMNS: ImportColumn[] = ["odooId", "name", "email", "roleTrack"];

/**
 * Choose which sheet to import.
 *
 * Prefers a tab named "Employees" (the name the generated template uses), and
 * otherwise falls back to the first sheet. Named-first matters because HR
 * workbooks routinely carry extra tabs — a notes page, a pivot, last year's
 * data — and silently importing whichever happens to sit leftmost is how the
 * wrong data set gets loaded without anyone noticing.
 */
function pickSheet(workbook: Array<{ sheet: string; data: unknown[][] }>): {
  sheet: string;
  data: unknown[][];
} {
  const named = workbook.find((s) => s.sheet.trim().toLowerCase() === PREFERRED_SHEET_NAME);
  return named ?? workbook[0];
}

export type LoadResult = {
  rows: EmployeeSourceRow[];
  /** Recognised headers, so the preview can tell HR what it read. */
  headerMap: HeaderMap;
  /** Which tab was imported, so the preview can say so out loud. */
  sheetName: string;
};

/**
 * Parse an uploaded workbook into source rows.
 *
 * Throws `ImportFileError` for file-level problems (too large, unreadable, no
 * usable header, missing a required column). Row-level problems are NOT thrown:
 * they travel on as null values and become §3.4 rejections in validate.ts.
 */
export async function loadEmployeesFromXlsx(
  buffer: Buffer,
  opts: { maxRows?: number } = {},
): Promise<LoadResult> {
  const maxRows = opts.maxRows ?? MAX_ROWS;

  if (buffer.byteLength === 0) {
    throw new ImportFileError("empty_file", "The uploaded file is empty.");
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new ImportFileError(
      "file_too_large",
      `The file is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ` +
        `${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    );
  }

  // Given a Buffer, the library returns EVERY sheet as `{ sheet, data }`, so
  // sheet selection is an explicit decision here rather than an implicit
  // "whatever is first" — see `pickSheet`.
  let workbook: Array<{ sheet: string; data: unknown[][] }>;
  try {
    workbook = (await readXlsxFile(buffer)) as unknown as Array<{
      sheet: string;
      data: unknown[][];
    }>;
  } catch (cause) {
    // The parser's own message can name internal structures; it is not useful
    // to an HR user and echoing it verbatim would leak parser internals into a
    // UI. Deliberately generic, with the real error kept as `cause` for Sentry.
    throw new ImportFileError(
      "unreadable_file",
      "The file could not be read as an Excel workbook. Export it again as .xlsx and retry.",
      { cause },
    );
  }

  if (!Array.isArray(workbook) || workbook.length === 0) {
    throw new ImportFileError("empty_file", "The workbook has no sheets.");
  }
  if (workbook.length > MAX_SHEETS) {
    throw new ImportFileError(
      "too_many_sheets",
      `The workbook has ${workbook.length} sheets; the limit is ${MAX_SHEETS}.`,
    );
  }

  const picked = pickSheet(workbook);
  const sheet = picked.data;

  if (sheet.length === 0) {
    throw new ImportFileError("empty_file", `Sheet "${picked.sheet}" has no rows.`);
  }

  const headerMap = mapHeaders(sheet[0] ?? []);

  const missing = REQUIRED_COLUMNS.filter((c) => headerMap[c] === undefined);
  if (missing.length > 0) {
    throw new ImportFileError(
      "missing_required_columns",
      `The sheet is missing required column(s): ${missing.join(", ")}. ` +
        `Download the template to see the expected headers.`,
    );
  }

  const bodyRows = sheet.slice(1);
  if (bodyRows.length > maxRows) {
    throw new ImportFileError(
      "too_many_rows",
      `The sheet has ${bodyRows.length} rows; the limit is ${maxRows}.`,
    );
  }

  const read = (row: unknown[], column: ImportColumn): string | null => {
    const index = headerMap[column];
    if (index === undefined) return null;
    return cellToString(row[index]);
  };

  const rows: EmployeeSourceRow[] = [];
  bodyRows.forEach((row, i) => {
    // +2: one for the header row, one because humans count from 1. The number
    // must match what HR sees in Excel's own row gutter or it is worse than
    // useless in a rejection message.
    const rowNumber = i + 2;

    // A wholly empty row is trailing formatting, not a record. Skipping it
    // silently is right: reporting "row 4001 is empty" for a sheet with a
    // thousand blank rows below the data would bury the real findings.
    const isEmpty = IMPORT_COLUMNS.every((c) => read(row, c) === null);
    if (isEmpty) return;

    rows.push({
      rowNumber,
      odooId: read(row, "odooId"),
      name: read(row, "name"),
      email: read(row, "email"),
      dateOfJoining: read(row, "dateOfJoining"),
      department: read(row, "department"),
      entity: read(row, "entity"),
      managerOdooId: read(row, "managerOdooId"),
      roleTrack: read(row, "roleTrack"),
      basicSalary: read(row, "basicSalary"),
      status: read(row, "status"),
      lastWorkingDay: read(row, "lastWorkingDay"),
      unpaidLeaveDays: read(row, "unpaidLeaveDays"),
    });
  });

  return { rows, headerMap, sheetName: picked.sheet };
}
