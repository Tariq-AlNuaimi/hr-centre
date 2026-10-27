import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * UX review P0 (docs/blueprints/ux-p0.md, AC-7.1): user-facing English copy
 * never cites the internal spec. "(§5.1)" means nothing to an employee and
 * reads as a leak of how the system was built. The section numbers belong in
 * code comments, where the next developer looks for them.
 *
 * English only: the Arabic bundle is a placeholder the operator left as it is.
 */

function strings(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === "string") return [[path.join("."), node]];
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => strings(v, [...path, k]));
  }
  return [];
}

test("no spec section reference (§) in any English message", () => {
  const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as unknown;
  const offenders = strings(en).filter(([, v]) => v.includes("§"));
  assert.deepEqual(
    offenders.map(([k]) => k),
    [],
    "move the section number into a code comment and say it in plain words",
  );
});

test("the Performance refusal reasons shown on Home carry no spec reference", () => {
  for (const file of ["lib/pms/rating.ts", "lib/pms/evidence.ts", "lib/pms/change-request.ts"]) {
    const src = readFileSync(file, "utf8");
    // Only string literals: a `"…(§5.1)."` sentence is copy, a `// §5.1` comment is not.
    const literals = src.match(/"[^"\n]*§[^"\n]*"/g) ?? [];
    assert.deepEqual(literals, [], `${file} shows a spec reference to the user`);
  }
});

test("the login panel describes HR Centre, not one module", () => {
  const brand = readFileSync("brand.config.ts", "utf8");
  assert.match(brand, /description:\s*"Rihal Group.s HR system/);
  assert.doesNotMatch(brand, /description:\s*"Performance management/);
});
