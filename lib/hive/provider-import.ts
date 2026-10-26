/**
 * Turning a spreadsheet's rows into network provider records (§4.6, US5).
 *
 * Pure: takes the `unknown[][]` that `read-excel-file` hands back and returns
 * what should be written plus what could not be. It touches no filesystem and
 * no database, which is the point — `scripts/hive-import-providers.mjs` is then
 * a shell around ONE library call, and everything that can actually be wrong
 * about an import (a header this does not recognise, a row silently dropped, a
 * number where a phone should be) is testable without a real `.xlsx`.
 *
 * The rules here exist because of what this data decides. A 464-row list is
 * where an employee finds out whether their clinic direct-bills, so a row that
 * cannot be imported has to be REPORTED rather than skipped: a quiet drop means
 * a clinic goes missing and nobody learns about it until someone is told,
 * wrongly, that they are not covered.
 *
 * @public
 */

/** "Provider Name", "provider_name" and "PROVIDERNAME" are the same column. */
function normaliseHeader(header: unknown): string {
  return String(header ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Accepted header names per field.
 *
 * Generous on purpose. Alaa exports whatever Rihal's insurer sends, and an
 * import that fails on "Wilayat" instead of "Location" sends her to a developer
 * — precisely what §4.2 says must not be necessary.
 */
const COLUMNS = {
  name: ["name", "providername", "provider", "clinic", "hospital", "facility"],
  providerType: ["type", "providertype", "category", "speciality", "specialty"],
  location: ["location", "city", "area", "town", "wilayat", "region"],
  address: ["address", "fulladdress", "street"],
  phone: ["phone", "telephone", "tel", "contact", "phonenumber", "mobile"],
} as const;

type ProviderField = keyof typeof COLUMNS;
type ColumnIndex = Partial<Record<ProviderField, number>>;

export function mapHeaders(header: unknown[]): ColumnIndex {
  const seen = header.map(normaliseHeader);
  const index: ColumnIndex = {};
  for (const field of Object.keys(COLUMNS) as ProviderField[]) {
    // `findIndex`, so the FIRST matching column wins: a sheet carrying both
    // "Name" and "Facility" is one where the earlier column is the primary.
    const at = seen.findIndex((h) => (COLUMNS[field] as readonly string[]).includes(h));
    if (at >= 0) index[field] = at;
  }
  return index;
}

interface ProviderRecord {
  name: string;
  location: string;
  providerType: string | null;
  address: string | null;
  phone: string | null;
}

interface SkippedRow {
  /** 1-based line in the sheet, header included, so it matches what Alaa sees. */
  line: number;
  reason: string;
}

/**
 * A cell as trimmed text, or null.
 *
 * `String(raw)` because a spreadsheet hands back TYPED values: a phone number
 * entered without its `+` arrives as a JavaScript number, and a `typeof` check
 * would drop it.
 */
export function cell(row: unknown[], index: ColumnIndex, field: ProviderField): string | null {
  const at = index[field];
  if (at === undefined) return null;
  const raw = row[at];
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value.length > 0 ? value : null;
}

export interface ParseResult {
  parsed: ProviderRecord[];
  skipped: SkippedRow[];
  /** Required fields the header did not supply, so the caller can refuse early. */
  missingColumns: ProviderField[];
}

const REQUIRED: readonly ProviderField[] = ["name", "location"];

/**
 * Parse a whole sheet.
 *
 * `name` and `location` are required; the rest are optional, because an
 * insurer's export routinely omits a phone column and refusing the whole file
 * over that would help nobody.
 */
export function parseProviderSheet(rows: unknown[][]): ParseResult {
  if (rows.length === 0) return { parsed: [], skipped: [], missingColumns: [...REQUIRED] };

  const index = mapHeaders(rows[0]);
  const missingColumns = REQUIRED.filter((f) => index[f] === undefined);
  if (missingColumns.length > 0) return { parsed: [], skipped: [], missingColumns };

  const parsed: ProviderRecord[] = [];
  const skipped: SkippedRow[] = [];

  for (const [n, row] of rows.slice(1).entries()) {
    const name = cell(row, index, "name");
    const location = cell(row, index, "location");
    if (!name || !location) {
      skipped.push({ line: n + 2, reason: !name ? "no name" : "no location" });
      continue;
    }
    parsed.push({
      name,
      location,
      providerType: cell(row, index, "providerType"),
      address: cell(row, index, "address"),
      phone: cell(row, index, "phone"),
    });
  }

  return { parsed, skipped, missingColumns: [] };
}

/**
 * The provider rows from what `read-excel-file` returns. v9 returns the
 * WORKBOOK — `[{ sheet, data }]` — not the first sheet's rows; HIVE's script
 * treated the result as rows, so a real workbook read as "no data rows"
 * (fixed in the port). Accepts either shape; the provider list is the first
 * sheet.
 */
export function firstSheetRows(result: unknown): unknown[][] {
  if (!Array.isArray(result) || result.length === 0) return [];
  const first = result[0] as unknown;
  if (first && typeof first === "object" && !Array.isArray(first) && "data" in first) {
    const data = (first as { data: unknown }).data;
    return Array.isArray(data) ? (data as unknown[][]) : [];
  }
  return result as unknown[][];
}
