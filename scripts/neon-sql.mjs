#!/usr/bin/env node
// Query the app DB over HTTPS/443 from a Claude Code web session, where raw TCP :5432
// to Neon is firewalled (docs/runbooks/browser-egress-in-web-sessions.md §Bonus).
// Uses Neon's serverless driver (SQL over HTTPS). Read-only diagnostics helper — the
// app itself still talks to the DB through Prisma; this never runs in the request path.
//
// Usage:
//   node scripts/neon-sql.mjs "select count(*) from users"
//   make db-sql SQL="select 1"
//
// Connection URI (first set wins): NEON_READONLY_URL (preferred — a dedicated read-only
// Neon role, so diagnostics run least-privilege) > DBURL > DATABASE_URL (the app's
// read-write role; used with a loud warning). The query comes from argv OR $SQL (make
// exports it as an env var, NOT spliced into a shell string — otherwise a backtick in the
// value would execute as a shell command under the Bash(make *) allow).
// SELECT-only: refuses anything else so an injected/accidental write can't hit the DB.
// Output is redacted (REDACT_FIELDS) so a `select *` over users/accounts can't dump
// password hashes or tokens to the console.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CA = "/root/.ccr/ca-bundle.crt";

// Field names whose VALUES must never be printed by this diagnostics helper. Kept a
// SUPERSET of lib/prisma/audit-extension.ts SCRUB_FIELDS (asserted in
// tests/contracts/audit-scrub.test.ts) — this is a plain .mjs script so it can't import
// the TS audit module at runtime; the parity test is what stops the two lists drifting.
export const REDACT_FIELDS = new Set([
  "passwordHash",
  "password",
  "refresh_token",
  "access_token",
  "id_token",
  "session_state",
  "sessionToken",
  "token",
  "secret",
  "apiKey",
  "api_key",
  // Restricted compensation data (PMS spec §4.5 / §11.6) — a `select * from
  // employees` in this diagnostics helper must not print salaries to a console
  // or a terminal scrollback.
  "basicSalary",
  "basic_salary",
]);

// Redact any REDACT_FIELDS key in each returned row before it is printed.
export function redactRows(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = REDACT_FIELDS.has(k) && v != null ? "[redacted]" : v;
    }
    return out;
  });
}

async function main() {
  // The serverless driver fetches over HTTPS through the egress proxy; Node reads
  // NODE_EXTRA_CA_CERTS only at startup, so re-exec once with the egress CA + env-proxy
  // trust when it isn't already set (makes both `node …` and `make db-sql` work directly).
  if (!process.env.NODE_EXTRA_CA_CERTS && existsSync(CA)) {
    const r = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, NODE_EXTRA_CA_CERTS: CA, NODE_USE_ENV_PROXY: "1" },
    });
    process.exit(r.status ?? 1);
  }

  const sqlText = process.argv[2] || process.env.SQL;
  if (!sqlText) {
    console.error('usage: node scripts/neon-sql.mjs "<SQL>"   (or: make db-sql SQL="<SQL>")');
    process.exit(1);
  }
  // Read-only diagnostics only: a single SELECT (or WITH…SELECT). Refuse writes/DDL and
  // statement-chaining so this tool can never mutate the live DB (audit/soft-delete bypass).
  if (!/^\s*(select|with)\b/i.test(sqlText) || /;\s*\S/.test(sqlText.trim().replace(/;\s*$/, ""))) {
    console.error("refused: db-sql is SELECT-only and single-statement (read-only diagnostics)");
    process.exit(1);
  }
  const url = process.env.NEON_READONLY_URL || process.env.DBURL || process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "set NEON_READONLY_URL (preferred) or DATABASE_URL / DBURL to the Neon connection URI",
    );
    process.exit(1);
  }
  if (!process.env.NEON_READONLY_URL) {
    console.error(
      "warning: NEON_READONLY_URL not set — querying with the app's read-write role. " +
        "Provision a read-only Neon role and set NEON_READONLY_URL to keep diagnostics least-privilege.",
    );
  }

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  try {
    const rows = await sql.query(sqlText);
    console.log(JSON.stringify(redactRows(rows), null, 2));
  } catch (e) {
    console.error("query failed:", e.message);
    process.exit(1);
  }
}

// Run the CLI only when invoked directly, so tests can import the pure helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
