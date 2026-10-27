#!/usr/bin/env node
// V2-401 — integration-test runner with an ephemeral pgvector container.
//
// The integration suite (tests/integration/*.test.ts — pgvector round-trip, audit +
// soft-delete on a real DB) needs a live Postgres with the `vector` extension. This runner
// resolves one of three ways, in order, so the SAME `npm run test:integration` works on a
// dev box, in CI, and in a DB-less sandbox:
//
//   1. A real DATABASE_URL is already reachable (the native-Postgres path, or a dev DB) →
//      run the suite straight against it. Nothing is provisioned or torn down.
//   2. Else a Docker daemon is up → start an ephemeral `pgvector/pgvector:pg16` container
//      (@testcontainers/postgresql), `prisma migrate deploy` into it, run the suite against
//      it, and ALWAYS tear it down.
//   3. Else → print an HONEST skip notice (no Docker, no DB) and run the suite anyway; its
//      DB-guarded tests self-skip. It never silently reports a pass as if the round-trips ran.
//
// Exit code: the suite's own status when it runs (a real test failure → non-zero → RED);
// 0 when the environment can't provide a DB (skip is not a failure). `scripts/ship.mjs`'s
// FULL phase (`ship:full` / SHIP_FULL=1) invokes this and degrades to a WARN on the skip
// path (mirrors the ADR-030 docker gate), RED on a genuine failure.
//
// Build-vs-buy: docs/build-vs-buy-ledger.md (V2-401); ADR-061.

import { spawnSync } from "node:child_process";

// `--experimental-test-module-mocks` is not optional: several suites here call
// `mock.module` to stand in for `lib/auth`, and without the flag node throws
// "mockApi.module is not a function" in a beforeEach hook — which node:test
// reports as a FAILED test, not a skipped one. So the gate was red for a reason
// that had nothing to do with the code under test, and the failure names an
// internal API rather than the missing flag. `npm test` has carried the flag
// since the contract suite started mocking; this runner never did.
const TEST_CMD = [
  "--experimental-test-module-mocks",
  "--import",
  "tsx",
  "--test",
  "tests/integration/*.test.ts",
];
const PGVECTOR_IMAGE = "pgvector/pgvector:pg16";

/** Run the node:test integration suite with the given env; return its exit code. */
function runSuite(env) {
  const res = spawnSync("node", TEST_CMD, { stdio: "inherit", env });
  return res.status ?? 1;
}

/** Is a DATABASE_URL set to something that looks real (not unset / a placeholder)? */
function haveRealDbUrl() {
  const u = process.env.DATABASE_URL;
  return !!u && !/placeholder|user:password@localhost/.test(u);
}

/** Is a Docker daemon reachable? (binary on PATH AND `docker info` succeeds.) */
function dockerDaemonUp() {
  const res = spawnSync("docker", ["info"], { stdio: "ignore" });
  return res.status === 0;
}

/**
 * The suites need the demo fixture (`SEED_DEMO=1` seed: org, employees, starter
 * roles). Against an empty migrated DB ~95 tests failed with 403/404s that named
 * nothing about seeding (QA 2026-10-27). Returns the number of employees, or
 * null when the database cannot be read at all.
 */
async function fixtureEmployees(databaseUrl) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const r = await client.query("SELECT count(*)::int AS n FROM employees");
    return r.rows[0].n;
  } catch {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Seed the demo fixture into `env.DATABASE_URL`. Exit status of the seed. */
function seedFixture(env) {
  console.log("integration: seeding the demo fixture (SEED_DEMO=1 prisma db seed) ...");
  const seed = spawnSync("npx", ["prisma", "db", "seed"], {
    stdio: "inherit",
    env: { ...env, SEED_DEMO: "1" },
  });
  return seed.status ?? 1;
}

async function main() {
  // (1) Caller already provided a reachable DB — use it as-is, but never against
  //     an unseeded one: seed it when asked (INTEGRATION_SEED=1), else fail fast.
  if (haveRealDbUrl()) {
    console.log("integration: using the existing DATABASE_URL (no container provisioned).");
    const n = await fixtureEmployees(process.env.DATABASE_URL);
    if (n === 0) {
      if (process.env.INTEGRATION_SEED === "1") {
        const status = seedFixture(process.env);
        if (status !== 0) process.exit(status);
      } else {
        console.error(
          "integration: the database has no employees — the suites need the demo fixture.\n" +
            "  Seed it first (`SEED_DEMO=1 npx prisma db seed`, after `prisma migrate deploy`),\n" +
            "  or re-run with INTEGRATION_SEED=1 to let this runner seed it. Never point this at\n" +
            "  production: the suites write.",
        );
        process.exit(1);
      }
    } else if (n === null) {
      console.error(
        "integration: cannot read the `employees` table — run `prisma migrate deploy` against\n" +
          "  DATABASE_URL first.",
      );
      process.exit(1);
    }
    process.exit(runSuite(process.env));
  }

  // (3) No DB and no Docker — honest skip. Run the suite so it self-skips with its notice.
  if (!dockerDaemonUp()) {
    console.log(
      "integration: no reachable DATABASE_URL and no Docker daemon — cannot provision an\n" +
        "  ephemeral pgvector container here. Running the suite in SKIP mode (its DB-guarded\n" +
        "  tests self-skip). Run this where Docker (or a pgvector DATABASE_URL) is available for\n" +
        "  the real round-trip — e.g. CI, or a dev box with `make db-up`.",
    );
    // Exit 0: a skip is not a failure. The suite still runs and reports its own skipped cases.
    process.exit(runSuite(process.env));
  }

  // (2) Docker is up — spin an ephemeral pgvector container, migrate, run, tear down.
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  console.log(`integration: starting an ephemeral ${PGVECTOR_IMAGE} container ...`);
  const container = await new PostgreSqlContainer(PGVECTOR_IMAGE).start();
  const databaseUrl = container.getConnectionUri();
  const env = { ...process.env, DATABASE_URL: databaseUrl };
  let code = 1;
  try {
    console.log("integration: applying migrations (prisma migrate deploy) ...");
    const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env });
    if (migrate.status !== 0) {
      console.error("integration: `prisma migrate deploy` failed against the container.");
      code = migrate.status ?? 1;
    } else {
      // A fresh container is empty: the suites need the demo fixture.
      code = seedFixture(env);
      if (code === 0) code = runSuite(env);
    }
  } finally {
    console.log("integration: stopping the ephemeral container ...");
    await container.stop();
  }
  process.exit(code);
}

main().catch((e) => {
  console.error("integration: runner error —", e?.message ?? e);
  process.exit(1);
});
