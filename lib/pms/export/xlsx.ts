import writeXlsxFile from "write-excel-file/node";
import { COLUMN_TITLES, IMPORT_COLUMNS, type ImportColumn } from "../import/types";

/**
 * Excel emission — the write half of ADR-066's two-file engine seam.
 *
 * This file is the ONLY place that imports `write-excel-file`. Phase 5's
 * payroll export (§11.7) lands here alongside the import template, so the
 * engine stays swappable from one place.
 *
 * Phase 1 emits one artifact: the blank import template, so HR can see the
 * exact headers the loader recognises instead of guessing at them from prose.
 */

/**
 * A short, concrete example row.
 *
 * A template with only headers gets filled in wrong — HR guesses at date format,
 * at how to spell a role track, at whether a C-Level row needs a department.
 * Every one of those guesses is a §3.4 rejection on the first upload. One filled
 * row answers all of them by demonstration, and the accompanying note says to
 * delete it.
 *
 * The row deliberately includes a C-Level employee, because §1.2's exception
 * (entity, no department, no manager) is the single most likely thing to be got
 * wrong and the hardest to infer from a header alone.
 */
const EXAMPLE_ROWS: Array<Record<ImportColumn, string>> = [
  {
    odooId: "1001",
    name: "Example — delete this row",
    email: "example@rihal.om",
    dateOfJoining: "2021-03-15",
    department: "Marketing",
    entity: "RIHAL",
    managerOdooId: "1000",
    roleTrack: "Manager",
    basicSalary: "1500",
    status: "Active",
    lastWorkingDay: "",
    unpaidLeaveDays: "0",
  },
  {
    odooId: "1000",
    name: "Example C-Level — delete this row",
    email: "example.clevel@rihal.om",
    dateOfJoining: "2018-01-08",
    department: "",
    entity: "RIHAL",
    managerOdooId: "",
    roleTrack: "C-Level",
    basicSalary: "3000",
    status: "Active",
    lastWorkingDay: "",
    unpaidLeaveDays: "0",
  },
];

/**
 * Build the blank employee-import template.
 *
 * Column widths are set so a header is readable without the operator resizing
 * every column — a small thing that decides whether the template feels like a
 * tool or a chore.
 */
/**
 * The library exposes several overloads (a row matrix, an object + schema form,
 * and a multi-sheet form). TypeScript resolves an untyped call here to the
 * object-schema overload, whose `columns` require a per-field `cell` renderer
 * that the row-matrix form does not use. This alias pins the row-matrix
 * signature — the API actually in play — so the narrowing lives in exactly one
 * place instead of as a cast at each call.
 *
 * Note the return: the writer resolves to a handle exposing `toBuffer` /
 * `toStream` / `toFile`, NOT to a Buffer. (An earlier cast here claimed Buffer
 * and typechecked cleanly while returning an object — caught by the round-trip
 * test in tests/contracts/pms-import.test.ts, which is why that test asserts on
 * real bytes rather than on types.)
 */
type WriteRowMatrix = (
  rows: Array<Array<{ value: string }>>,
  options: { columns?: Array<{ width?: number }>; sheet?: string },
) => Promise<{ toBuffer: () => Promise<Buffer> }>;

const writeRowMatrix = writeXlsxFile as unknown as WriteRowMatrix;

/**
 * Build the blank employee-import template.
 *
 * Column widths are set so a header is readable without the operator resizing
 * every column — a small thing that decides whether the template feels like a
 * tool or a chore.
 */
export async function buildImportTemplate(): Promise<Buffer> {
  const header = IMPORT_COLUMNS.map((column) => ({ value: COLUMN_TITLES[column] }));

  const body = EXAMPLE_ROWS.map((example) =>
    IMPORT_COLUMNS.map((column) => ({ value: example[column] })),
  );

  const writer = await writeRowMatrix([header, ...body], {
    columns: IMPORT_COLUMNS.map((column) => ({
      width: Math.max(COLUMN_TITLES[column].length + 4, 14),
    })),
    sheet: "Employees",
  });

  return writer.toBuffer();
}

/** Download headers for an .xlsx response. */
export function xlsxDownloadHeaders(filename: string): Record<string, string> {
  return {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    // Quoted and stripped of anything that could break out of the header or
    // steer a browser into treating the response as something else.
    "content-disposition": `attachment; filename="${filename.replace(/[^\w.\-]/g, "_")}"`,
    "cache-control": "no-store",
  };
}
