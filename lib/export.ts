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
//     return new Response(xlsx, { headers: excelDownloadHeaders(`projects-${Date.now()}.xlsx`) });
//   });
//
// Security: exports MUST go through `withAuth`/`withAdminAuth` and respect the
// same row-level filters as the list endpoint. Restricted columns (passwordHash,
// salary, tokens) must NOT appear in the column list -- SCRUB_FIELDS does not
// protect export output.

import ExcelJS from "exceljs";

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

  let headerRowIdx = 1;
  if (options.title) {
    sheet.mergeCells(1, 1, 1, Math.max(1, columns.length));
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = options.title;
    titleCell.font = { bold: true, size: 14 };
    sheet.addRow([]);
    headerRowIdx = 3;
  }

  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 20,
  }));

  const headerRow = sheet.getRow(headerRowIdx);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE6E6E6" },
  };
  headerRow.commit();

  for (const row of data) {
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      const raw = row[col.key] as T[keyof T & string];
      out[col.key] = col.format ? col.format(raw, row) : (raw ?? "");
    }
    sheet.addRow(out);
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
