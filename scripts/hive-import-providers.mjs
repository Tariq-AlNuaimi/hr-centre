#!/usr/bin/env node
// scripts/hive-import-providers.mjs — HIVE blueprint task 4.3's import half (US5),
// ported to HR Centre (ADR-079). The Ticket setup → Providers screen offers the
// same import as an upload for HR; this command is for IT / bulk loads.
//
//   npm run hive:providers -- path/to/network-providers.xlsx
//   npm run hive:providers -- path/to/file.xlsx --replace
//
// OQ-7 resolved this task's one real risk by deferring it: "build with
// placeholder documents; the real five arrive as data." The 464-row provider
// list is the one of those five that is not a document at all — it is rows, and
// rows need an importer. §4.2's "no developer is involved" applies, so this is
// a command Alaa or IT runs against the spreadsheet she already has, rather
// than a migration someone has to write.
//
// Reads `.xlsx` DIRECTLY (`read-excel-file`, the pick in `docs/oss-catalog.md`)
// rather than asking for a CSV export first. That export is where encoding and
// quoting damage happens — a UTF-8 BOM on the first header, a quoted newline in
// an address column — so the conversion step is the risk, not the mitigation.
// See the build-vs-buy ledger entry for the hand-rolled parser this replaced
// and the exact bug it had.
//
// Columns are matched by HEADER NAME, case- and space-insensitively, so a sheet
// with "Provider Name" or "provider_name" both work. `name` and `location` are
// required; type/address/phone are optional.

import path from "node:path";
import { pathToFileURL } from "node:url";
import readXlsxFile from "read-excel-file/node";
import { firstSheetRows, parseProviderSheet } from "../lib/hive/provider-import.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const replace = args.includes("--replace");

if (!file) {
  console.error(
    "usage: npm run hive:providers -- <file.xlsx> [--replace]\n" +
      "  --replace  retire every existing provider first, so the file becomes the whole list\n" +
      "             (without it, new rows are added and existing ones left alone)",
  );
  process.exit(1);
}

async function main() {
  // read-excel-file v9 returns the workbook; the provider list is the first sheet.
  const rows = firstSheetRows(await readXlsxFile(path.resolve(file)));
  if (rows.length < 2) {
    console.error(`hive:providers: ${file} has no data rows.`);
    process.exit(1);
  }

  // Everything that can be wrong about the SHEET is decided in
  // `lib/hive/provider-import.ts`, which is pure and unit-tested. This file
  // owns only the parts that need a disk and a database.
  const { parsed, skipped, missingColumns } = parseProviderSheet(rows);
  if (missingColumns.length > 0) {
    console.error(
      `hive:providers: could not find ${missingColumns.map((c) => `a "${c}"`).join(" or ")} column ` +
        `in the header.\n  header was: ${rows[0].join(" | ")}`,
    );
    process.exit(1);
  }

  if (parsed.length === 0) {
    // Refuse BEFORE touching anything. `--replace` on a file that parsed to
    // nothing would wipe the list and leave every employee being told "the
    // network provider list has not been uploaded yet".
    console.error(
      `hive:providers: ${file} produced no importable rows (${skipped.length} skipped). ` +
        `Nothing was changed.`,
    );
    for (const s of skipped) console.error(`  line ${s.line}: ${s.reason}`);
    process.exit(1);
  }

  const { prisma, auditedTransaction } = await import(
    pathToFileURL(path.resolve("lib/prisma.ts")).href
  );

  // One transaction. Without it a `--replace` that dies partway leaves the list
  // half-retired and half-imported, and the rows that never arrived are
  // indistinguishable from providers that are genuinely not in the network.
  // Shared with the admin screen's upload (lib/hive/services/providers.ts).
  const { cleared, added } = await auditedTransaction(async (tx) => {
    let cleared = 0;
    if (replace) {
      // `deleteMany`, NOT `updateMany`. The soft-delete extension rewrites
      // `deleteMany` into the same `deletedAt` stamp AND writes one audit row
      // per record; a hand-written `updateMany` is hooked by neither, so
      // retiring 464 rows would leave no trace at all. In HR Centre the
      // retired rows are restorable from the recycling bin (NetworkProvider is
      // registered there).
      const result = await tx.networkProvider.deleteMany({ where: { deletedAt: null } });
      cleared = result.count;
    }

    let added = 0;
    for (const row of parsed) {
      const existing = await tx.networkProvider.findFirst({
        where: { name: row.name, location: row.location, deletedAt: null },
        select: { id: true },
      });
      if (existing) continue;
      await tx.networkProvider.create({ data: row });
      added += 1;
    }
    return { cleared, added };
  });

  if (replace) console.log(`hive:providers: retired ${cleared} existing rows (--replace).`);

  console.log(
    `hive:providers: ${added} added, ${parsed.length - added} already present, ` +
      `${skipped.length} skipped.`,
  );
  for (const s of skipped) console.log(`  line ${s.line}: ${s.reason}`);

  const total = await prisma.networkProvider.count({ where: { deletedAt: null } });
  console.log(`hive:providers: ${total} providers in the network list.`);
  // §4.6 says 464. Stated rather than enforced: the number is whatever Rihal's
  // current list holds, and a hard check would fail the day it changes.
  if (total !== 464) {
    console.log(`  note: §4.6 describes a 464-entry list; this is ${total}.`);
  }

  // The pg pool keeps the process alive otherwise, so the command appears to
  // hang after printing its summary.
  await prisma.$disconnect();
}

main().catch((err) => {
  // A bad path or an unreadable sheet should read as one line, not an
  // unhandled-rejection stack trace at someone who is running an import.
  console.error(`hive:providers: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
