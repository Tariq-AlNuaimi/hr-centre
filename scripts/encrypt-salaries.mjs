#!/usr/bin/env node
/**
 * ADR-067 step 2 — encrypt every plaintext `basic_salary` into
 * `basic_salary_enc`, then prove it before anyone drops the source column.
 *
 * This is the step that CANNOT live inside a migration. Encryption needs the
 * application key, which SQL does not have, and `prisma migrate deploy` would
 * happily run an add-column and a drop-column back to back with nothing in
 * between. So the plan is three deliberate steps:
 *
 *   1. migration `20260825120000_…`  — adds `basic_salary_enc`, drops nothing
 *   2. THIS SCRIPT                    — encrypts, then verifies by decrypting
 *                                       every row back and comparing
 *   3. a later migration              — drops `basic_salary`, only after (2)
 *
 * Between 1 and 3 the database holds both columns. That is the point: step 2 is
 * reversible right up until step 3 runs.
 *
 * Usage (against whichever database DATABASE_URL points at):
 *
 *   node scripts/encrypt-salaries.mjs            # encrypt + verify
 *   node scripts/encrypt-salaries.mjs --verify   # verify only, change nothing
 *
 * Safe to re-run: rows that already hold a `v1.` envelope are skipped, so an
 * interrupted run resumes rather than double-encrypting.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import {
  encryptField,
  envelopeMatchesPlaintext,
  isEncryptedEnvelope,
} from "../lib/crypto/field-encryption.ts";

const VERIFY_ONLY = process.argv.includes("--verify");
const BATCH = 200;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (!process.env.SALARY_ENCRYPTION_KEY) {
  console.error(
    "SALARY_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32\n" +
      "It must be the SAME key the application will run with, or nothing written here " +
      "will be readable by the app.",
  );
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Read straight through `$queryRaw` rather than the Prisma model.
 *
 * `basic_salary` is deliberately absent from every application `select` now, so
 * the generated client is the wrong tool for reading it — and this is exactly
 * the audited, placeholder-free raw read CLAUDE.md's Prisma rule permits.
 */
async function plaintextRows() {
  return prisma.$queryRaw`
    SELECT "id", "odoo_id", "basic_salary"::text AS "salary", "basic_salary_enc"
    FROM "employees"
    WHERE "basic_salary" IS NOT NULL
    ORDER BY "odoo_id"
  `;
}

const rows = await plaintextRows();
console.log(`${rows.length} employee(s) with a plaintext salary on file.`);

let encrypted = 0;
let skipped = 0;

if (!VERIFY_ONLY) {
  for (let i = 0; i < rows.length; i += BATCH) {
    for (const row of rows.slice(i, i + BATCH)) {
      if (row.basic_salary_enc && isEncryptedEnvelope(row.basic_salary_enc)) {
        skipped += 1;
        continue;
      }
      const envelope = encryptField(row.salary, row.odoo_id);
      await prisma.$executeRaw`
        UPDATE "employees" SET "basic_salary_enc" = ${envelope} WHERE "id" = ${row.id}
      `;
      encrypted += 1;
    }
    console.log(`  … ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log(`Encrypted ${encrypted}, skipped ${skipped} already-encrypted.`);
}

// --- verification -------------------------------------------------------------
//
// Decrypt EVERY row back and compare against the plaintext still in the source
// column. This is the whole reason the source column is still there.

const after = await plaintextRows();
const failures = [];
for (const row of after) {
  if (!row.basic_salary_enc) {
    failures.push({ odooId: row.odoo_id, why: "no ciphertext written" });
    continue;
  }
  if (!envelopeMatchesPlaintext(row.basic_salary_enc, row.salary, row.odoo_id)) {
    // The VALUE is never printed — this is Restricted data and the failure is
    // identified by employee, not by amount.
    failures.push({ odooId: row.odoo_id, why: "ciphertext does not decrypt to the source value" });
  }
}

const orphans = await prisma.$queryRaw`
  SELECT COUNT(*)::int AS "n" FROM "employees"
  WHERE "basic_salary" IS NULL AND "basic_salary_enc" IS NOT NULL
`;

console.log(`Verified ${after.length - failures.length}/${after.length} row(s).`);
if (orphans[0].n > 0) {
  console.log(
    `${orphans[0].n} row(s) have a ciphertext but no plaintext — written by the app since ` +
      `the migration. Nothing to verify against; that is expected and fine.`,
  );
}

await prisma.$disconnect();

if (failures.length > 0) {
  console.error(`\nFAILED on ${failures.length} row(s). Do NOT run the drop migration.`);
  for (const f of failures.slice(0, 20)) console.error(`  - employee ${f.odooId}: ${f.why}`);
  process.exit(1);
}

console.log(
  "\nAll rows verified. Step 3 (the migration that drops basic_salary) is safe to run.\n" +
    "Re-run this with --verify immediately before it if any time has passed.",
);
