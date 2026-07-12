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
// Reads DATABASE_URL (or DBURL) for the connection URI. The query comes from argv OR
// $SQL (make exports it as an env var, NOT spliced into a shell string — otherwise a
// backtick in the value would execute as a shell command under the Bash(make *) allow).
// SELECT-only: refuses anything else so an injected/accidental write can't hit the DB.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const CA = "/root/.ccr/ca-bundle.crt";

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
const url = process.env.DBURL || process.env.DATABASE_URL;
if (!url) {
  console.error("set DATABASE_URL (or DBURL) to the Neon connection URI");
  process.exit(1);
}

const { neon } = await import("@neondatabase/serverless");
const sql = neon(url);
try {
  const rows = await sql.query(sqlText);
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.error("query failed:", e.message);
  process.exit(1);
}
