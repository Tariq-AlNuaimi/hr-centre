// Excel export helper using ExcelJS.
//
// Pattern: define columns once, point them at a Prisma findMany result, get a
// Buffer back. Hand the Buffer to NextResponse with the right content-type to
// stream a download.
//
// Example:
//
//   import { toExcel } from "@/lib/export";
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
//     return new Response(new Uint8Array(xlsx), {
//       headers: {
//         "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
//         "content-disposition": `attachment; filename="projects-${Date.now()}.xlsx"`,
//       },
//     });
//   });
//
// PDF export is intentionally not included in this iteration -- pdfkit's font
// resolution under Next.js `output: standalone` is fragile and requires
// outputFileTracingIncludes tuning. Track as a future ADR if a project needs it.
//
// Security note: exports MUST go through `withAuth`/`withAdminAuth` and respect
// the same row-level filters as the regular list endpoint. Restricted columns
// (passwordHash, salary, tokens) must NOT be in the column list -- the audit
// extension's SCRUB_FIELDS does not protect export output.

import ExcelJS from "exceljs";

export interface ExportColumn<T> {
  /** Column header text displayed in row 1 (or row 3 if a title is set). */
  header: string;
  /** Property name on each row. Used both as the column id and to look up values. */
  key: keyof T & string;
  /** Optional width hint (in Excel column-width units). Default 20. */
  width?: number;
  /** Optional formatter -- transforms the raw cell value to a string for display. */
  format?: (value: T[keyof T & string], row: T) => string | number | Date | null;
}

export interface ToExcelOptions {
  /** Sheet name. Default "Data". Excel allows up to 31 chars; longer values are truncated. */
  sheetName?: string;
  /** Optional title in row 1 (header row shifts to row 3). */
  title?: string;
  /** Optional creator / lastModifiedBy metadata. Default "Rihal Ops". */
  creator?: string;
}

export async function toExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: ExportColumn<T>[],
  options: ToExcelOptions = {}
): Promise<Buffer> {
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

  // ExcelJS replaces the row at `headerRowIdx` with the headers when sheet.columns is set,
  // but it doesn't apply formatting -- do that explicitly.
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

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Sets the headers a Next.js Response needs to surface as a download in the browser.
 * Convenience wrapper -- you can always set them by hand.
 */
export function excelDownloadHeaders(filename: string): Record<string, string> {
  const safe = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  return {
    "content-type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="${safe.replace(/"/g, "")}"`,
  };
}
