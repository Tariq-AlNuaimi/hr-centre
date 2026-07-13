// Contract tests for the scaffold generator (scripts/scaffold-entity.mjs) — the
// most-used skill, previously only smoke-tested in the DORMANT verify.yml CI.
// These run on every `npm test` / `/ship`, locally and DB-free.
//
// We drive the generator's `--dry-run` mode (it computes every write + patch,
// including the all-or-nothing marker preconditions, then prints the PLAN and
// exits WITHOUT touching the filesystem). So these assert the planned output and
// the input-validation guards without writing or cleaning up a single file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT, runScript } from "./_run-script";

const SCRIPT = path.join(ROOT, "scripts", "scaffold-entity.mjs");

/** Run the generator; return { code, stdout, stderr }. Never throws on non-zero. */
const runScaffold = (args: string[]) => runScript(SCRIPT, args);

test("dry-run (scalars only): plans all writes + patches, writes nothing", () => {
  const { code, stdout } = runScaffold([
    "--dry-run",
    "--name",
    "TestScalar",
    "--fields",
    "title:string,note:string?,count:int,active:boolean",
  ]);
  assert.equal(code, 0, "dry-run should exit 0");
  assert.match(stdout, /--- DRY RUN ---/);

  // New files planned (the CRUD surface): validation, API routes, pages, components.
  for (const frag of [
    "lib/validations/test-scalar.ts",
    "app/api/test-scalar/route.ts",
    path.join("app/api/test-scalar", "[id]", "route.ts"),
    "components/test-scalar",
  ]) {
    assert.ok(
      stdout.includes(`would write`) && stdout.includes(frag),
      `expected a planned write for ${frag}`,
    );
  }

  // Existing files patched (all-or-nothing markers must resolve).
  for (const frag of [
    "prisma/schema.prisma",
    "lib/prisma/soft-delete-extension.ts",
    "lib/prisma/recyclable.ts",
    "components/layout/AppSidebar.tsx",
    "messages/en.json",
    "messages/ar.json",
  ]) {
    assert.ok(
      stdout.includes(`would patch`) && stdout.includes(frag),
      `expected a planned patch for ${frag}`,
    );
  }

  // Critically: dry-run must NOT have written anything.
  assert.equal(
    existsSync(path.join(ROOT, "lib/validations/test-scalar.ts")),
    false,
    "dry-run must not write files",
  );
  assert.equal(
    existsSync(path.join(ROOT, "app/api/test-scalar")),
    false,
    "dry-run must not write files",
  );
});

test("dry-run (enums + relations): resolves markers + plans the schema patch", () => {
  const { code, stdout } = runScaffold([
    "--dry-run",
    "--name",
    "TestRel",
    "--fields",
    "title:string",
    "--enums",
    "state:OPEN|CLOSED",
    "--relations",
    "owner:User?",
  ]);
  assert.equal(code, 0, "dry-run with enums+relations should exit 0");
  assert.match(stdout, /--- DRY RUN ---/);
  assert.ok(
    stdout.includes("would patch") && stdout.includes("prisma/schema.prisma"),
    "schema patch (model + enum + back-ref) should be planned",
  );
  assert.equal(
    existsSync(path.join(ROOT, "app/api/test-rel")),
    false,
    "dry-run must not write files",
  );
});

test("rejects a relation to a non-existent model", () => {
  const { code, stderr, stdout } = runScaffold([
    "--dry-run",
    "--name",
    "TestBadRel",
    "--fields",
    "title:string",
    "--relations",
    "owner:NoSuchModel?",
  ]);
  assert.notEqual(code, 0, "should fail when the relation target does not exist");
  assert.match(stderr + stdout, /NoSuchModel|not found/i);
});

test("rejects a non-PascalCase entity name", () => {
  const { code, stderr, stdout } = runScaffold([
    "--dry-run",
    "--name",
    "not_pascal",
    "--fields",
    "title:string",
  ]);
  assert.notEqual(code, 0, "should reject a non-PascalCase name");
  assert.match(stderr + stdout, /PascalCase/i);
});

test("requires at least one of --fields / --enums / --relations", () => {
  const { code, stderr, stdout } = runScaffold(["--dry-run", "--name", "TestEmpty"]);
  assert.notEqual(code, 0, "should fail with no fields/enums/relations");
  assert.match(stderr + stdout, /--fields|--enums|--relations|required/i);
});

test("rejects an unknown flag (strict parseArgs)", () => {
  const { code, stderr, stdout } = runScaffold([
    "--dry-run",
    "--name",
    "TestScalar",
    "--fields",
    "title:string",
    "--nonsense",
    "x",
  ]);
  assert.notEqual(code, 0, "strict parseArgs should reject a typo'd flag");
  assert.match(stderr + stdout, /Unknown option|nonsense/i);
});
