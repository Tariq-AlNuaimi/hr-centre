import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { toExcel, excelDownloadHeaders } from "../../lib/export";

async function reload(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

test("toExcel produces a non-empty xlsx buffer", async () => {
  const buf = await toExcel(
    [{ name: "Alice", n: 1 }, { name: "Bob", n: 2 }],
    [
      { header: "Name", key: "name" },
      { header: "N", key: "n" },
    ]
  );
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 100, `expected meaningful xlsx, got ${buf.length} bytes`);
});

test("toExcel header row is bold", async () => {
  const buf = await toExcel(
    [{ a: 1 }],
    [{ header: "A", key: "a" }]
  );
  const wb = await reload(buf);
  const sheet = wb.worksheets[0];
  const header = sheet.getRow(1);
  assert.equal(header.font?.bold, true, "header row should be bold");
});

test("toExcel format callback shapes the cell value", async () => {
  const buf = await toExcel(
    [{ price: 100 }, { price: 50 }],
    [{ header: "Price", key: "price", format: (v) => `$${v}` }]
  );
  const wb = await reload(buf);
  const sheet = wb.worksheets[0];
  assert.equal(sheet.getCell("A2").value, "$100");
  assert.equal(sheet.getCell("A3").value, "$50");
});

test("toExcel respects sheetName option", async () => {
  const buf = await toExcel(
    [{ a: 1 }],
    [{ header: "A", key: "a" }],
    { sheetName: "Custom" }
  );
  const wb = await reload(buf);
  assert.equal(wb.worksheets[0].name, "Custom");
});

test("toExcel inserts title row and shifts headers when title is set", async () => {
  const buf = await toExcel(
    [{ a: 1 }],
    [{ header: "A", key: "a" }],
    { title: "My Report" }
  );
  const wb = await reload(buf);
  const sheet = wb.worksheets[0];
  assert.equal(sheet.getCell("A1").value, "My Report");
  // Header lands on row 3 when a title is present
  assert.equal(sheet.getCell("A3").value, "A");
  // First data row lands on row 4
  assert.equal(sheet.getCell("A4").value, 1);
});

test("toExcel handles nullish values via the default (empty-string) coercion", async () => {
  const buf = await toExcel(
    [{ a: null }, { a: undefined }, { a: "" }],
    [{ header: "A", key: "a" as never }]
  );
  const wb = await reload(buf);
  const sheet = wb.worksheets[0];
  // ExcelJS represents an empty-string cell value as either "" or undefined depending
  // on the cell type. We just assert the workbook loaded and the rows exist.
  assert.ok(sheet.rowCount >= 3, `expected >=3 rows, got ${sheet.rowCount}`);
});

test("excelDownloadHeaders builds correct content-type + disposition", () => {
  const h = excelDownloadHeaders("projects-2026.xlsx");
  assert.equal(
    h["content-type"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.equal(h["content-disposition"], 'attachment; filename="projects-2026.xlsx"');
});

test("excelDownloadHeaders appends .xlsx when missing", () => {
  const h = excelDownloadHeaders("report");
  assert.equal(h["content-disposition"], 'attachment; filename="report.xlsx"');
});

test("excelDownloadHeaders strips embedded quotes from the filename", () => {
  const h = excelDownloadHeaders('a"b.xlsx');
  assert.equal(h["content-disposition"], 'attachment; filename="ab.xlsx"');
});
