// Minimal CSV parser for the bounded, known-schema asset import (T11). Single-pass
// state machine: handles "quoted, fields", escaped "" quotes, and CR/LF line ends.
// Not a full RFC-4180 streaming parser — a fork needing that scales up to `csv-parse`
// (build-vs-buy ledger, 2026-07-18).

/** Parse CSV text into a 2-D array of string cells. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty lines (e.g. a trailing newline).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Parse CSV into objects keyed by the (trimmed) header row. */
export function parseCsvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? "").trim();
    });
    return obj;
  });
}
