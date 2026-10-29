// Contract: notice links and the access gate (docs/blueprints/limits.md slice 2).
// DB-free. The behaviour against real records lives in
// tests/integration/notice-access.test.ts; this pins the static half: every link
// a Hiring / JML / tickets notice can carry has an access rule, so no emitter
// can add a link the gate silently refuses (or, worse, one it never checks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { hasAccessRule, isGatedHref, whoCanOpen } from "../../lib/core/notify/audience";

const ROOT = new URL("../../", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Files that emit notices: anything calling the user/JML notifiers. */
const emitters = [...walk(join(ROOT, "lib")), ...walk(join(ROOT, "app/api"))].filter((f) => {
  const src = readFileSync(f, "utf8");
  return /\bnotifyUsers\(|\bnotifyJml\(|\bJmlNotice\b/.test(src) && !f.includes("lib/core/notify/");
});

test("the emitter scan found the modules it is meant to cover", () => {
  const rel = emitters.map((f) => f.slice(ROOT.length));
  for (const expected of [
    "lib/hiring/notify.ts",
    "lib/hive/services/ticket-notify.ts",
    "lib/jml/routing/assign.ts",
    "lib/jml/sweep.ts",
  ]) {
    assert.ok(rel.includes(expected), `${expected} should be scanned`);
  }
});

test("every gated link a notice can carry has an access rule", () => {
  const missing: string[] = [];
  for (const file of emitters) {
    const src = readFileSync(file, "utf8");
    // Every module path literal in an emitter, not only `href:` lines — a link
    // is often chosen in a conditional (`what === "offer" ? … : …`).
    for (const m of src.matchAll(/[`"](\/(?:hiring|tickets|jml|approvals)[^`"\s]*)[`"]/g)) {
      const href = m[1].replace(/\$\{[^}]+\}/g, "id");
      if (isGatedHref(href) && !hasAccessRule(href)) missing.push(`${file}: ${href}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("the gate covers the module prefixes and nothing else", () => {
  for (const href of ["/hiring/offers/x", "/tickets/x", "/jml/cases/x?tab=a", "/approvals"]) {
    assert.equal(isGatedHref(href), true, href);
  }
  for (const href of ["/performance/x", "/people/x", "/hiringx", null]) {
    assert.equal(isGatedHref(href), false, String(href));
  }
});

test("record links resolve to rules; unknown module links do not", () => {
  for (const href of [
    "/hiring/requisitions/r1/approval",
    "/hiring/requisitions/r1/jd",
    "/hiring/offers/o1",
    "/hiring/panel/i1/score",
    "/tickets/t1",
    "/jml/cases/c1?tab=overview",
    "/jml/my-tasks",
    "/approvals",
  ]) {
    assert.equal(hasAccessRule(href), true, href);
  }
  for (const href of ["/hiring/close-out", "/hiring/panel/i1", "/jml/settings", "/tickets"]) {
    assert.equal(hasAccessRule(href), false, href);
  }
});

test("an unknown module link is refused without touching the database", async () => {
  const open = await whoCanOpen("/hiring/nowhere", ["u1"], async () => {
    throw new Error("must not load grants");
  });
  assert.equal(open.size, 0);
});

test("an ungated link passes everyone through without a lookup", async () => {
  const open = await whoCanOpen("/performance/goals", ["u1", "u2", "u1"], async () => {
    throw new Error("must not load grants");
  });
  assert.deepEqual([...open], ["u1", "u2"]);
});

test("a failing access check refuses (fail closed)", async () => {
  const open = await whoCanOpen("/tickets/t1", ["u1"], async () => {
    throw new Error("grants unavailable");
  });
  assert.equal(open.size, 0);
});
