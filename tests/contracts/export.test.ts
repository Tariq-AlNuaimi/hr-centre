import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { toExcel, excelDownloadHeaders, neutralizeFormula } from "../../lib/export";

async function reload(buf: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  // ExcelJS's xlsx.load() parameter resolves to Buffer<ArrayBuffer> via its
  // bundled types. @types/node 22+ defaults the global Buffer to
  // Buffer<ArrayBufferLike>, which lacks `maxByteLength` / `resizable` etc.
  // Runtime is unaffected -- ExcelJS streams the bytes through jszip which
  // accepts any Uint8Array-like. If the type defaults ever realign, the
  // ts-expect-error will self-flag as unused so we can drop it.
  // @ts-expect-error -- Buffer<ArrayBufferLike> vs Buffer<ArrayBuffer> skew
  await wb.xlsx.load(buf);
  return wb;
}

test("toExcel produces a non-empty xlsx Uint8Array", async () => {
  const buf = await toExcel(
    [{ name: "Alice", n: 1 }, { name: "Bob", n: 2 }],
    [
      { header: "Name", key: "name" },
      { header: "N", key: "n" },
    ]
  );
  assert.ok(buf instanceof Uint8Array, "expected Uint8Array");
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
  assert.equal(sheet.getCell("A3").value, "A");
  assert.equal(sheet.getCell("A4").value, 1);
});

test("toExcel handles nullish values via the default (empty-string) coercion", async () => {
  const buf = await toExcel(
    [{ a: null }, { a: undefined }, { a: "" }],
    [{ header: "A", key: "a" as never }]
  );
  const wb = await reload(buf);
  const sheet = wb.worksheets[0];
  assert.ok(sheet.rowCount >= 3, `expected >=3 rows, got ${sheet.rowCount}`);
});

test("neutralizeFormula prefixes formula-trigger strings, leaves the rest", () => {
  // CWE-1236: leading = + - @ (and tab/CR) would execute as a formula.
  assert.equal(neutralizeFormula("=HYPERLINK(\"http://evil\")"), "'=HYPERLINK(\"http://evil\")");
  assert.equal(neutralizeFormula("+1+1"), "'+1+1");
  assert.equal(neutralizeFormula("-2"), "'-2");
  assert.equal(neutralizeFormula("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(neutralizeFormula("\tinjected"), "'\tinjected");
  assert.equal(neutralizeFormula("\rinjected"), "'\rinjected");
  // Inert text and non-strings untouched.
  assert.equal(neutralizeFormula("Alice"), "Alice");
  assert.equal(neutralizeFormula("a=b"), "a=b");
  assert.equal(neutralizeFormula(42), 42);
  assert.equal(neutralizeFormula(null), null);
});

test("toExcel neutralizes a formula-injection cell so it round-trips as inert text", async () => {
  const payload = "=HYPERLINK(\"http://evil.example\",\"click\")";
  const buf = await toExcel(
    [{ note: payload }],
    [{ header: "Note", key: "note" }]
  );
  const wb = await reload(buf);
  const cell = wb.worksheets[0].getCell("A2");
  // Stored as a plain string (apostrophe-guarded), NOT an Excel formula object.
  assert.equal(typeof cell.value, "string");
  assert.equal(cell.value, `'${payload}`);
});

test("excelDownloadHeaders builds correct content-type + disposition", () => {
  const h = excelDownloadHeaders("projects-2026.xlsx");
  assert.equal(
    h["content-type"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.equal(
    h["content-disposition"],
    `attachment; filename="projects-2026.xlsx"; filename*=UTF-8''projects-2026.xlsx`
  );
});

test("excelDownloadHeaders appends .xlsx when missing", () => {
  const h = excelDownloadHeaders("report");
  assert.equal(
    h["content-disposition"],
    `attachment; filename="report.xlsx"; filename*=UTF-8''report.xlsx`
  );
});

test("excelDownloadHeaders strips embedded quotes from the filename", () => {
  const h = excelDownloadHeaders('a"b.xlsx');
  assert.equal(
    h["content-disposition"],
    `attachment; filename="ab.xlsx"; filename*=UTF-8''a%22b.xlsx`
  );
});

test("excelDownloadHeaders neutralizes CRLF / semicolon header injection", () => {
  // A filename built from user data must not be able to inject headers or forge
  // Content-Disposition params. CR/LF/";"/"\" are stripped from the ASCII name.
  const h = excelDownloadHeaders('evil\r\nSet-Cookie: x=1;name.xlsx');
  const cd = h["content-disposition"];
  assert.ok(!/[\r\n]/.test(cd), "no raw CR/LF in the header value");
  assert.equal(cd.split('"')[1], "evilSet-Cookie: x=1name.xlsx");
});

test("excelDownloadHeaders maps non-ASCII to _ in filename and keeps UTF-8 in filename*", () => {
  const h = excelDownloadHeaders("rapport-café.xlsx");
  assert.equal(
    h["content-disposition"],
    `attachment; filename="rapport-caf_.xlsx"; filename*=UTF-8''rapport-caf%C3%A9.xlsx`
  );
});
