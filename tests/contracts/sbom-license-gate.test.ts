// Contract: the SBOM-based license gate (O5, ADR-051 §2) — scripts/sbom-license-gate.mjs.
//
// The warm lock-scan (license-gate.test.ts) covers the DENY/allowlist/dual logic; this pins the
// SBOM-specific extraction that feeds it: deriving a package name from a CycloneDX `purl`
// (incl. URL-encoded scopes), mapping the three license-entry shapes (`license.id` /
// `license.name` / `expression`) to a string, and building the synthetic {name:{license}} map
// so a denied license anywhere in the shippable SBOM is caught. Importing the module must NOT
// run the gate (the `import.meta.url` guard) — asserted implicitly by this file loading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateLicenses } from "../../scripts/license-gate.mjs";
import {
  componentName,
  licenseEntryString,
  sbomToLockLikeMap,
} from "../../scripts/sbom-license-gate.mjs";

test("componentName derives the npm name from a purl (incl. URL-encoded scopes)", () => {
  assert.equal(componentName({ purl: "pkg:npm/lodash@4.17.21" }), "lodash");
  assert.equal(componentName({ purl: "pkg:npm/%40prisma/client@7.6.0" }), "@prisma/client");
  assert.equal(componentName({ purl: "pkg:npm/next@16.2.10?foo=bar" }), "next");
  // Fallbacks when no purl.
  assert.equal(componentName({ group: "@acme", name: "util" }), "@acme/util");
  assert.equal(componentName({ name: "plain" }), "plain");
});

test("licenseEntryString maps all three CycloneDX license-entry shapes", () => {
  assert.equal(licenseEntryString({ license: { id: "MIT" } }), "MIT");
  assert.equal(
    licenseEntryString({ license: { name: "Some Custom License" } }),
    "Some Custom License",
  );
  assert.equal(licenseEntryString({ expression: "MIT OR Apache-2.0" }), "MIT OR Apache-2.0");
  assert.equal(licenseEntryString({}), "");
  assert.equal(licenseEntryString(null), "");
});

test("sbomToLockLikeMap → evaluateLicenses flags a denied license, passes permissive", () => {
  const components = [
    { purl: "pkg:npm/good@1.0.0", licenses: [{ license: { id: "MIT" } }] },
    { purl: "pkg:npm/%40acme/util@2.0.0", licenses: [{ license: { id: "ISC" } }] },
    { purl: "pkg:npm/bad@3.0.0", licenses: [{ license: { id: "AGPL-3.0-only" } }] },
    { purl: "pkg:npm/nolic@1.0.0" }, // no licenses → unknown, never an offender
  ];
  const { offenders, unknown } = evaluateLicenses(sbomToLockLikeMap(components), {});
  assert.ok(offenders.has("bad"), "AGPL component must be an offender");
  assert.equal(offenders.get("bad")?.deny, "AGPL");
  assert.ok(!offenders.has("good") && !offenders.has("@acme/util"), "permissive licenses pass");
  assert.ok(unknown.includes("nolic"), "a no-license component is an unknown, not an offender");
});

test("duplicate component names AGGREGATE licenses — a denied version isn't overwritten", () => {
  // Two components share a name at different versions (version is stripped from the key).
  // The AGPL one must still be caught even though the MIT one is processed later (last-write
  // would have silently dropped it) — the gate's "denied license anywhere in the SBOM" claim.
  const components = [
    { purl: "pkg:npm/foo@1.0.0", licenses: [{ license: { id: "AGPL-3.0-only" } }] },
    { purl: "pkg:npm/foo@2.0.0", licenses: [{ license: { id: "MIT" } }] },
  ];
  const { offenders } = evaluateLicenses(sbomToLockLikeMap(components), {});
  assert.ok(offenders.has("foo"), "a denied license on a superseded version must still be flagged");
  assert.equal(offenders.get("foo")?.deny, "AGPL");
});

test("a dual SPDX expression is flagged until elected, then passes", () => {
  const components = [
    { purl: "pkg:npm/dual@1.0.0", licenses: [{ expression: "MIT OR GPL-3.0-only" }] },
  ];
  const bare = evaluateLicenses(sbomToLockLikeMap(components), {});
  assert.ok(bare.offenders.get("dual")?.dual, "GPL dual must be flagged as dual (needs election)");
  const elected = evaluateLicenses(sbomToLockLikeMap(components), {
    dual: { license: "MIT", reason: "MIT branch elected (test)" },
  });
  assert.ok(!elected.offenders.has("dual"), "an elected dual passes");
});
