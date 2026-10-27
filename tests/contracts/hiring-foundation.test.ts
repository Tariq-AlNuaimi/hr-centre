import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Hiring slice 1 — docs/blueprints/hiring.md AC1.2–AC1.4: compensation sealed
 * at rest (ADR-080 decision 2), the access predicates (decision 1) and the
 * approval-chain policy ported from Interview Hub.
 */

process.env.HIRING_COMP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.ID_ENCRYPTION_KEY = randomBytes(32).toString("base64");
delete process.env.HIRING_COMP_ENCRYPTION_KEY_PREVIOUS;

const crypto = await import("../../lib/hiring/comp-crypto");
const { resetKeyCacheForTests } = await import("../../lib/crypto/field-encryption");
const { expandGrants } = await import("../../lib/rbac/grants");
const access = await import("../../lib/hiring/access");
const chain = await import("../../lib/hiring/approval-chain");
const { SCRUB_FIELDS } = await import("../../lib/prisma/audit-extension");

// --- compensation at rest ------------------------------------------------------

test("a sealed amount round-trips and is ciphertext, not the figure", () => {
  const env = crypto.sealAmount("offer", "o1", "salary", 2750.5)!;
  assert.ok(env.startsWith("v1."), "an ADR-067 envelope");
  assert.ok(!env.includes("2750"), "the figure is not in the stored value");
  assert.equal(crypto.openAmount("offer", "o1", "salary", env), 2750.5);
  assert.equal(crypto.sealAmount("offer", "o1", "salary", null), null);
  assert.equal(crypto.openAmount("offer", "o1", "salary", null), null);
});

test("a ciphertext moved to another row or field will not open", () => {
  const env = crypto.sealAmount("offer", "o1", "salary", 900);
  assert.equal(crypto.openAmount("offer", "o2", "salary", env), null, "another offer");
  assert.equal(crypto.openAmount("candidate", "o1", "salary", env), null, "another model");
  assert.equal(crypto.openAmount("offer", "o1", "discussedSalary", env), null, "another field");
  assert.equal(crypto.isUnreadable("offer", "o2", "salary", env), true);
  assert.equal(crypto.isUnreadable("offer", "o1", "salary", env), false);
});

test("JSON terms round-trip; the NEC uses its own key", () => {
  const env = crypto.sealJson("offerVersion", "v1", "termsSnapshot", { salary: 1, housing: 2 });
  assert.deepEqual(crypto.openJson("offerVersion", "v1", "termsSnapshot", env), {
    salary: 1,
    housing: 2,
  });
  const nec = crypto.sealNec("c1", "12345678")!;
  assert.equal(crypto.openNec("c1", nec), "12345678");
  assert.equal(crypto.openNec("c2", nec), null);
  assert.equal(crypto.sealNec("c1", ""), null);
});

test("a missing key refuses to write (no plaintext fallback) and reads degrade", () => {
  const env = crypto.sealAmount("offer", "o1", "salary", 1000);
  const saved = process.env.HIRING_COMP_ENCRYPTION_KEY;
  delete process.env.HIRING_COMP_ENCRYPTION_KEY;
  resetKeyCacheForTests();
  try {
    assert.throws(
      () => crypto.sealAmount("offer", "o1", "salary", 1000),
      crypto.HiringCompKeyError,
    );
    assert.equal(crypto.openAmount("offer", "o1", "salary", env), null, "unavailable, not a crash");
  } finally {
    process.env.HIRING_COMP_ENCRYPTION_KEY = saved;
    resetKeyCacheForTests();
  }
});

test("non-finite amounts are refused; ids are minted before insert", () => {
  assert.throws(() => crypto.sealAmount("offer", "o1", "salary", Number.NaN), RangeError);
  const a = crypto.newHiringId();
  assert.match(a, /^h[0-9a-f]{32}$/);
  assert.notEqual(a, crypto.newHiringId());
});

test("every sealed column, the NEC and the DEI fields are scrubbed from audit", () => {
  for (const f of [
    "salaryEnc",
    "allowancesEnc",
    "salaryExpectationEnc",
    "statedAmountEnc",
    "termsSnapshotEnc",
    "discussedSalaryEnc",
    "necEnc",
    "profileData",
    "aiRationale",
    "aiWhyNot",
    "aiOutput",
    "aiAnalysis",
    "transcript",
    "deiGender",
    "deiEthnicity",
    "tokenHash",
  ]) {
    assert.ok(SCRUB_FIELDS.has(f), f);
  }
});

test("no hiring table stores pay outside an *Enc column", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const hiring = schema.slice(schema.indexOf("enum HiringRequisitionStatus"));
  for (const bare of [
    "salary ",
    "allowances ",
    "salaryExpectation ",
    "statedAmount ",
    "discussedSalary ",
  ]) {
    assert.ok(
      !new RegExp(`^\\s+${bare}`, "m").test(hiring),
      `${bare.trim()} is never a plain column`,
    );
  }
});

// --- access --------------------------------------------------------------------

const RIHAL = { entityId: "rihal", departmentId: null, directorateId: null };
const CL = { entityId: "cl", departmentId: null, directorateId: null };
const actor = (
  assignments: Array<{ permissions: string[]; scope: { type: string; id: string | null } }>,
) => ({ userId: "u1", name: "U", grants: expandGrants(assignments) });

test("a company-scoped grant acts in that company only", () => {
  const a = actor([
    { permissions: ["hiring.manage", "hiring.hrManager"], scope: { type: "COMPANY", id: "rihal" } },
  ]);
  assert.equal(access.can(a, "hiring.manage", RIHAL), true);
  assert.equal(access.can(a, "hiring.manage", CL), false);
  assert.equal(access.actsAs(a, "HR_MANAGER", RIHAL), true);
  assert.equal(access.canOverrideGates(a, CL), false);
  assert.equal(access.holdsAnywhere(a, "hiring.manage"), true);
});

test("configure counts only at Group scope (admin = Interview Hub ADMIN)", () => {
  assert.equal(
    access.isHiringAdmin(
      actor([{ permissions: ["hiring.configure"], scope: { type: "COMPANY", id: "rihal" } }]),
    ),
    false,
  );
  const admin = actor([{ permissions: ["hiring.configure"], scope: { type: "GROUP", id: null } }]);
  assert.equal(access.isHiringAdmin(admin), true);
  assert.equal(access.canOverrideGates(admin, CL), true);
  assert.equal(access.canSignJdForHr(admin, CL), true);
});

test("JD HR slot: HR Manager or HR Specialist; a panelist cannot", () => {
  const spec = actor([
    { permissions: ["hiring.hrSpecialist"], scope: { type: "GROUP", id: null } },
  ]);
  const panel = actor([
    { permissions: ["hiring.view", "hiring.panelist"], scope: { type: "GROUP", id: null } },
  ]);
  assert.equal(access.canSignJdForHr(spec, RIHAL), true);
  assert.equal(access.canSignJdForHr(panel, RIHAL), false);
  assert.equal(access.isPanelOnly(panel, RIHAL), true);
  assert.equal(access.seesPii(panel, RIHAL), false);
});

test("pay: viewComp, a routed approver, or the HM only when the requisition allows it (D10)", () => {
  const hm = actor([
    { permissions: ["hiring.view", "hiring.hiringManager"], scope: { type: "GROUP", id: null } },
  ]);
  assert.equal(access.seesComp(hm, RIHAL), false);
  assert.equal(access.seesComp(hm, RIHAL, { hiringManagerId: "u1", hmSeesSalary: false }), false);
  assert.equal(access.seesComp(hm, RIHAL, { hiringManagerId: "u1", hmSeesSalary: true }), true);
  assert.equal(access.seesComp(hm, RIHAL, { hiringManagerId: "u2", hmSeesSalary: true }), false);
  assert.equal(access.seesComp(hm, RIHAL, { routedApprover: true }), true);
  const hr = actor([{ permissions: ["hiring.viewComp"], scope: { type: "COMPANY", id: "cl" } }]);
  assert.equal(access.seesComp(hr, CL), true);
  assert.equal(access.seesComp(hr, RIHAL), false);
});

test("every approval role maps to a distinct hiring permission (D1: all assignable)", () => {
  const perms = Object.values(access.ROLE_PERMISSION);
  assert.equal(new Set(perms).size, access.APPROVAL_ROLES.length);
  for (const p of perms) assert.match(p, /^hiring\.[a-zA-Z]+$/);
});

// --- approval chains -----------------------------------------------------------

const roles = (steps: { role: string }[]) => steps.map((s) => s.role);

test("the documented floor: HR Manager then Operations Director", () => {
  assert.deepEqual(roles(chain.computeChain("RIHAL", 1000)), ["HR_MANAGER", "OPERATIONS_DIRECTOR"]);
  assert.deepEqual(roles(chain.computeChain(null, null)), ["HR_MANAGER", "OPERATIONS_DIRECTOR"]);
});

test("COO joins at TOTAL monthly comp ≥ threshold (offers only)", () => {
  assert.deepEqual(roles(chain.computeChain("TP", 2500)), [
    "HR_MANAGER",
    "OPERATIONS_DIRECTOR",
    "COO",
  ]);
  assert.deepEqual(roles(chain.computeChain("TP", 2499.999)).includes("COO"), false);
  assert.deepEqual(roles(chain.computeChain("TP", 99_999, { kind: "requisition" })), [
    "HR_MANAGER",
    "OPERATIONS_DIRECTOR",
  ]);
  assert.equal(chain.computeChain("TP", 3000, { threshold: 5000 }).length, 2);
  assert.equal(
    chain.totalMonthlyComp(2000, { housing: 400, transport: 100, bad: -5, x: "9" }),
    2500,
  );
  assert.equal(chain.totalMonthlyComp(null, { housing: 300 }), 300);
  assert.equal(chain.totalMonthlyComp(null, {}), null);
  assert.equal(chain.totalMonthlyComp(1000, [1, 2]), 1000);
  assert.equal(chain.escalatesToCoo(null), false);
});

test("an override can only ADD approvers, keeps its order and drops duplicates", () => {
  const overrides = { CL: ["DEPARTMENT_HEAD", "OPERATIONS_DIRECTOR", "DEPARTMENT_HEAD"] as const };
  assert.deepEqual(roles(chain.computeChain("CL", 0, { overrides: { CL: [...overrides.CL] } })), [
    "DEPARTMENT_HEAD",
    "OPERATIONS_DIRECTOR",
    "HR_MANAGER",
  ]);
  assert.deepEqual(roles(chain.computeChain("CL", 0, { overrides: { CL: [] } })), [
    "HR_MANAGER",
    "OPERATIONS_DIRECTOR",
  ]);
  assert.deepEqual(roles(chain.computeChain("CL", 9000, { overrides: { CL: ["COO"] } })), [
    "COO",
    "HR_MANAGER",
    "OPERATIONS_DIRECTOR",
  ]);
});

test("a stored snapshot is honoured; malformed JSON falls back to null", () => {
  assert.deepEqual(chain.chainFromSnapshot([{ sequence: 1, role: "COO" }]), [
    { sequence: 1, role: "COO" },
  ]);
  assert.equal(chain.chainFromSnapshot([]), null);
  assert.equal(chain.chainFromSnapshot("x"), null);
  assert.equal(chain.chainFromSnapshot([null]), null);
  assert.equal(chain.chainFromSnapshot([{ sequence: "1", role: "COO" }]), null);
  assert.equal(chain.chainFromSnapshot([{ sequence: 1, role: "ADMIN" }]), null);
});

test("the hiring starter roles use only catalogue codes and give every role a holder", async () => {
  const { HIRING_STARTER_ROLES } = await import("../../lib/hiring/roles");
  const { isPermission } = await import("../../lib/rbac/catalogue");
  const granted = new Set(HIRING_STARTER_ROLES.flatMap((r) => r.permissions));
  for (const r of HIRING_STARTER_ROLES)
    for (const p of r.permissions) assert.ok(isPermission(p), p);
  for (const p of Object.values(access.ROLE_PERMISSION))
    assert.ok(granted.has(p), `${p} is grantable`);
  assert.equal(new Set(HIRING_STARTER_ROLES.map((r) => r.key)).size, HIRING_STARTER_ROLES.length);
});
