import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseCsvToObjects } from "../../lib/csv";

test("parseCsv splits simple rows and drops blank lines", () => {
  const rows = parseCsv("a,b,c\n1,2,3\n\n4,5,6\n");
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1", "2", "3"],
    ["4", "5", "6"],
  ]);
});

test("parseCsv handles quoted fields with commas, quotes, and newlines", () => {
  const rows = parseCsv('name,note\n"Doe, John","said ""hi"""\n"multi\nline",x');
  assert.deepEqual(rows, [
    ["name", "note"],
    ["Doe, John", 'said "hi"'],
    ["multi\nline", "x"],
  ]);
});

test("parseCsv tolerates CRLF line endings", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseCsvToObjects keys rows by the trimmed header", () => {
  const objs = parseCsvToObjects("assetTag, name \nLAP-1,Laptop\nLAP-2,Monitor");
  assert.deepEqual(objs, [
    { assetTag: "LAP-1", name: "Laptop" },
    { assetTag: "LAP-2", name: "Monitor" },
  ]);
});

test("parseCsvToObjects returns [] for header-only or empty input", () => {
  assert.deepEqual(parseCsvToObjects(""), []);
  assert.deepEqual(parseCsvToObjects("assetTag,name\n"), []);
});
