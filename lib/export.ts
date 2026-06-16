// Excel export helper using ExcelJS.
//
// Returns `Uint8Array` rather than `Buffer` so callers don't get tangled in
// @types/node 22+'s generic `Buffer<ArrayBufferLike>` vs ExcelJS's older non-
// generic Buffer typing. Uint8Array is the broadest type that works with
// `Response`, `Buffer.from`, and `ExcelJS.xlsx.load`.
//
// Example:
//
//   import { toExcel, excelDownloadHeaders } from "@/lib/export";
//   import { withAuth } from "@/lib/api-helpers";
//
//   export const GET = withAuth(async () => {
//     const projects = await prisma.project.findMany({
//       include: { owner: { select: { name: true } } },
//     });
//     const xlsx = await toExcel(projects, [
//       { header: "Name", key: "name" },
//       { header: "Owner", key: "owner", format: (v) => v?.name ?? "-" },
//       { header: "Created", key: "createdAt", format: (v) => new Date(v).toISOString() },
//     ], { sheetName: "Projects", title: "Project export" });
//     return new Response(new Uint8Array(xlsx), { headers: excelDownloadHeaders(`projects-${Date.now()}.xlsx`) });
//   });
//
// Security: exports MUST go through `withAuth`/`withAdminAuth` and respect the
// same row-level filters as the list endpoint. Restricted columns (passwordHash,
// salary, tokens) must NOT appear in the column list -- SCRUB_FIELDS does not
// protect export output.

import ExcelJS from "exceljs";

// Neutralize spreadsheet formula injection (CWE-1236). A cell whose text starts
// with = + - @ (or a leading tab / carriage return) is executed as a formula
// when the .xlsx is opened, so user-supplied data like `=HYPERLINK(...)` becomes
// live code. Prefix such strings with an apostrophe, which Excel/Sheets treat as
// "force text" and strip on display. Non-string values (numbers, dates) are
// never formulas and pass through untouched.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
export function neutralizeFormula(
  value: string | number | Date | null
): string | number | Date | null {
  if (typeof value === "string" && FORMULA_TRIGGER.test(value)) {
    return `'${value}`;
  }
  return value;
}

export interface ExportColumn<T> {
  header: string;
  key: keyof T & string;
  width?: number;
  format?: (value: T[keyof T & string], row: T) => string | number | Date | null;
}

export interface ToExcelOptions {
  sheetName?: string;
  title?: string;
  creator?: string;
}

export async function toExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: ExportColumn<T>[],
  options: ToExcelOptions = {}
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = options.creator ?? "Rihal Ops";
  workbook.lastModifiedBy = options.creator ?? "Rihal Ops";
  workbook.created = new Date();

  const sheetName = (options.sheetName ?? "Data").slice(0, 31);
  const sheet = workbook.addWorksheet(sheetName);

  // Set column widths up front. We deliberately do NOT assign sheet.columns
  // because that API implicitly writes the headers into row 1, which collides
  // with a title row when options.title is set.
  for (let i = 0; i < columns.length; i++) {
    sheet.getColumn(i + 1).width = columns[i].width ?? 20;
  }

  // Optional title row (merged across all columns).
  if (options.title) {
    const titleRow = sheet.addRow([options.title]);
    titleRow.font = { bold: true, size: 14 };
    sheet.mergeCells(1, 1, 1, Math.max(1, columns.length));
    sheet.addRow([]); // spacer row between title and headers
  }

  // Header row -- always written explicitly so it can be styled and so it
  // lands at the right row index whether or not a title is present.
  const headerRow = sheet.addRow(columns.map((c) => c.header));
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE6E6E6" },
  };

  // Data rows. Iterate columns in order so the cells line up under the headers
  // even if the row object has properties in a different order.
  for (const row of data) {
    const rowData = columns.map((col) => {
      const raw = row[col.key] as T[keyof T & string];
      const value = col.format ? col.format(raw, row) : (raw ?? "");
      return neutralizeFormula(value as string | number | Date | null);
    });
    sheet.addRow(rowData);
  }

  // exceljs.xlsx.writeBuffer's typed return drifts between releases and across
  // @types/node versions. Normalize to Uint8Array (the runtime is always a
  // typed-array view either way).
  const result = await workbook.xlsx.writeBuffer();
  return result instanceof Uint8Array
    ? result
    : new Uint8Array(result as ArrayBuffer);
}

/**
 * Standard download headers for an .xlsx response.
 */
export function excelDownloadHeaders(filename: string): Record<string, string> {
  const safe = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  return {
    "content-type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="${safe.replace(/"/g, "")}"`,
  };
}
