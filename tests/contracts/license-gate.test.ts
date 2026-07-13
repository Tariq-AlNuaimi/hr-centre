// Contract: the /ship license gate (ADR-051 §2) — scripts/license-gate.mjs +
// scripts/license-allowlist.json.
//
// Invariants asserted here:
//   1. the committed allowlist parses and every election carries a "reason"
//      (a reasonless entry would be a silent waiver, which ADR-051 forbids);
//   2. the deny set flags AGPL/SSPL/BUSL/Elastic/GPL-only, and does NOT flag
//      LGPL, MPL-2.0, or permissive licenses;
//   3. a dual license (SPDX OR with a permissive branch) is flagged until an
//      explicit election exists, then passes;
//   4. an UNKNOWN (missing) license is a reported unknown, never an offender;
//   5. the REAL lockfile is green under the committed allowlist — the gate
//      starts green and only bites on a genuine future regression (ADR-051).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DENY, evaluateLicenses, loadAllowlist } from "../../scripts/license-gate.mjs";

const allowlistSrc = readFileSync(
  new URL("../../scripts/license-allowlist.json", import.meta.url),
  "utf8",
);

test("committed allowlist parses and every election has a non-empty reason", () => {
  const elections = loadAllowlist(allowlistSrc);
  assert.ok(Object.keys(elections).length >= 1, "expected at least one election");
  for (const [name, entry] of Object.entries(elections)) {
    assert.ok(
      typeof entry.reason === "string" && entry.reason.trim().length > 0,
      `election "${name}" must carry a reason`,
    );
  }
});

test("loadAllowlist rejects a reasonless election", () => {
  assert.throws(
    () => loadAllowlist(JSON.stringify({ elections: { evil: { license: "MIT" } } })),
    /missing a non-empty "reason"/,
  );
});

test("synthetic AGPL/SSPL/BUSL/Elastic/GPL-only deps are flagged", () => {
  const { offenders } = evaluateLicenses(
    {
      "": { license: "MIT" }, // root project — skipped
      "node_modules/evil-agpl": { license: "AGPL-3.0-only" },
      "node_modules/evil-sspl": { license: "SSPL-1.0" },
      "node_modules/evil-busl": { license: "BUSL-1.1" },
      "node_modules/evil-elastic": { license: "Elastic-2.0" },
      "node_modules/evil-gpl": { license: "GPL-3.0-only", dev: true },
    },
    {},
  );
  assert.equal(offenders.get("evil-agpl")?.deny, "AGPL");
  assert.equal(offenders.get("evil-sspl")?.deny, "SSPL");
  assert.equal(offenders.get("evil-busl")?.deny, "BUSL");
  assert.equal(offenders.get("evil-elastic")?.deny, "Elastic");
  assert.equal(offenders.get("evil-gpl")?.deny, "GPL-only");
  assert.equal(offenders.get("evil-gpl")?.dev, true, "dev deps are scanned too");
});

test("LGPL, MPL-2.0, and permissive licenses are NOT flagged", () => {
  const { offenders, unknown } = evaluateLicenses(
    {
      "node_modules/weak-lgpl": { license: "LGPL-2.1-or-later" },
      "node_modules/weak-mpl": { license: "MPL-2.0" },
      "node_modules/fine-mit": { license: "MIT" },
      "node_modules/fine-apache": { license: "Apache-2.0" },
      "node_modules/fine-blueoak": { license: "BlueOak-1.0.0" },
    },
    {},
  );
  assert.equal(offenders.size, 0);
  assert.equal(unknown.length, 0);
  // Regression guard on the GPL-only pattern itself: no word boundary inside LGPL.
  const gplOnly = DENY.find((d) => d.id === "GPL-only");
  assert.ok(gplOnly && !gplOnly.re.test("LGPL-3.0-only"));
});

test("dual license (MIT OR GPL) is flagged without an election, passes with one", () => {
  const pkgs = { "node_modules/jszip": { license: "(MIT OR GPL-3.0-or-later)" } };
  const withoutElection = evaluateLicenses(pkgs, {});
  assert.equal(withoutElection.offenders.get("jszip")?.dual, true);

  const withElection = evaluateLicenses(pkgs, {
    jszip: { license: "MIT", reason: "MIT elected (ADR-051)" },
  });
  assert.equal(withElection.offenders.size, 0);
  assert.ok(withElection.elections.some((e) => e.startsWith("jszip ")));
});

test("missing license field is a reported unknown, not an offender; a documented exception silences it", () => {
  const pkgs = { "node_modules/mystery": {} };
  const bare = evaluateLicenses(pkgs, {});
  assert.deepEqual(bare.unknown, ["mystery"]);
  assert.equal(bare.offenders.size, 0);

  const excepted = evaluateLicenses(pkgs, {
    mystery: { license: "UNKNOWN", reason: "documented exception" },
  });
  assert.deepEqual(excepted.unknown, []);
});

test("the real package-lock.json is green under the committed allowlist", () => {
  const lock = JSON.parse(
    readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"),
  );
  const elections = loadAllowlist(allowlistSrc);
  const { scanned, offenders } = evaluateLicenses(lock.packages, elections);
  assert.ok(scanned > 1000, `expected a full tree scan, saw ${scanned}`);
  assert.deepEqual(
    [...offenders.keys()],
    [],
    "denied license in the tree — drop the dep or record an election (ADR-051)",
  );
});
