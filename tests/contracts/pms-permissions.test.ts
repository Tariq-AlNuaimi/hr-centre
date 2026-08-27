import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// ADR-067: the serializer decrypts, so these tests need a key. A throwaway one
// per run — nothing here reads or writes a real database.
process.env.SALARY_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

import {
  canActOnEmployee,
  canApplyImport,
  canConfigure,
  canExportMasterResults,
  canPreviewImport,
  canRunCalibration,
  canViewCompensation,
  canViewEmployee,
  capabilitiesFor,
  hasOrgWideVisibility,
  isReadOnly,
  canSeePlatformAdminRoster,
  type PmsActor,
} from "../../lib/pms/permissions";
import { employeeSelect, serializeEmployee } from "../../lib/pms/employee-select";
import { encryptField } from "../../lib/crypto/field-encryption";

/**
 * Contract tests for PMS authority — spec §4.
 *
 * The §4.5 tests are the sharpest ones here. "Line managers never see salary —
 * even for their own direct reports and even in their chain view" is the kind of
 * rule that is easy to satisfy in a component and quietly violate in a payload,
 * so these assert on the SELECT and on the serialized object, not on rendering.
 */

function actor(over: Partial<PmsActor> = {}): PmsActor {
  return {
    userId: "user-1",
    employeeId: "emp-1",
    pmsRoles: [],
    isLineManager: false,
    ...over,
  };
}

const plainEmployee = actor();
const lineManager = actor({ employeeId: "mgr-1", isLineManager: true });
const hrSuperAdmin = actor({ employeeId: "hr-1", pmsRoles: ["HR_SUPER_ADMIN"] });
const hrbp = actor({ employeeId: "hr-2", pmsRoles: ["HRBP"] });
const executive = actor({ employeeId: "exec-1", pmsRoles: ["EXECUTIVE_VIEWER"] });
/** §4.3 — the COO: an executive viewer who ALSO manages a team. Not a hybrid role. */
const cooWhoManages = actor({
  employeeId: "coo-1",
  pmsRoles: ["EXECUTIVE_VIEWER"],
  isLineManager: true,
});
/** A platform ADMIN with no employee record (ADR-065). */
const unlinked = actor({ employeeId: null });

// --- §4.5 / §11.6 field-level compensation confidentiality ------------------

test("§4.5 a line manager cannot view compensation", () => {
  assert.equal(
    canViewCompensation(lineManager),
    false,
    "the spec says never — not even for their own direct reports",
  );
});

test("§4.5 HR (both flavours) and the executive viewer can view compensation", () => {
  assert.equal(canViewCompensation(hrSuperAdmin), true);
  assert.equal(canViewCompensation(hrbp), true);
  assert.equal(canViewCompensation(executive), true);
});

test("§4.5 salary is absent from the SELECT for an unentitled actor", () => {
  // The rule is enforced where the query is built, so the column never enters
  // the payload — not hidden afterwards by a component or a serializer. Since
  // ADR-067 that also means an unentitled actor never holds the CIPHERTEXT,
  // which is what keeps decryption strictly inside the entitled branch.
  const managerSelect = employeeSelect(lineManager) as Record<string, unknown>;
  for (const column of ["basicSalary", "basicSalaryEnc"]) {
    assert.ok(!(column in managerSelect), `${column} must not be selected at all`);
  }

  const hrSelect = employeeSelect(hrSuperAdmin) as Record<string, unknown>;
  assert.equal(hrSelect.basicSalaryEnc, true, "the entitled actor selects the ciphertext");
  assert.ok(
    !("basicSalary" in hrSelect),
    "and never the legacy plaintext column, which is pending drop (ADR-067 step 3)",
  );
});

test("§4.5 a ciphertext from another employee is refused, not rendered", () => {
  // The attack the AAD exists for, at the layer that actually serves it: a row
  // whose salary envelope was copied from someone else must fail loudly rather
  // than disclose. See ADR-067.
  assert.throws(() =>
    serializeEmployee({
      id: "e1",
      odooId: "1204",
      name: "Report",
      email: "r@example.com",
      roleTrack: "INDIVIDUAL",
      status: "ACTIVE",
      dateOfJoining: null,
      managerId: null,
      department: null,
      entity: { id: "ent1", code: "RIHAL", name: "Rihal" },
      manager: null,
      basicSalaryEnc: encryptField("5500", "1001"),
    }),
  );
});

test("§4.5 a serialized row for a manager has no basicSalary KEY at all", () => {
  // Not null, not "[redacted]" — absent. A placeholder would be indistinguishable
  // from "no salary recorded", and a client could not tell the two apart.
  const row = {
    id: "e1",
    odooId: "1001",
    name: "Report",
    email: "r@example.com",
    roleTrack: "INDIVIDUAL",
    status: "ACTIVE",
    dateOfJoining: null,
    managerId: "mgr-1",
    department: { id: "d1", name: "Engineering" },
    entity: { id: "ent1", code: "RIHAL", name: "Rihal" },
    manager: null,
  };
  const serialized = serializeEmployee(row);
  assert.ok(!("basicSalary" in serialized));
  assert.doesNotMatch(JSON.stringify(serialized), /salary/i);
});

test("§4.5 an entitled actor sees null for an employee with no salary on file", () => {
  // "Not recorded" and "not allowed to see" are different facts; the UI renders
  // them differently, so the key must be present-and-null in the first case.
  const serialized = serializeEmployee({
    id: "e1",
    odooId: "1001",
    name: "Report",
    email: "r@example.com",
    roleTrack: "INDIVIDUAL",
    status: "ACTIVE",
    dateOfJoining: null,
    managerId: null,
    department: null,
    entity: { id: "ent1", code: "RIHAL", name: "Rihal" },
    manager: null,
    basicSalaryEnc: null,
  });
  assert.ok("basicSalary" in serialized);
  assert.equal(serialized.basicSalary, null);
});

test("§11.4 salary decrypts to a decimal string, never a float", () => {
  // §11.3 multiplies this by a coefficient and §11.4 pro-rates it over days.
  // Since ADR-067 the column holds a ciphertext bound to the employee's odooId,
  // so this also pins that the serializer opens it with the RIGHT binding.
  const serialized = serializeEmployee({
    id: "e1",
    odooId: "1001",
    name: "Report",
    email: "r@example.com",
    roleTrack: "INDIVIDUAL",
    status: "ACTIVE",
    dateOfJoining: null,
    managerId: null,
    department: null,
    entity: { id: "ent1", code: "RIHAL", name: "Rihal" },
    manager: null,
    basicSalaryEnc: encryptField("1234.500", "1001"),
  });
  assert.equal(serialized.basicSalary, "1234.500");
  assert.equal(typeof serialized.basicSalary, "string");
});

// --- §4.2 visibility vs action ----------------------------------------------

test("§4.2 a manager views their whole chain but acts only on direct reports", () => {
  const descendants = new Set(["direct-1", "deep-1", "deep-2"]);

  // View follows the whole chain, however deep.
  assert.equal(canViewEmployee(lineManager, "deep-2", descendants), true);

  // Action follows exactly one link. That difference IS the rule (§4.2:
  // "Editing/sign-off is always reserved for the direct line manager").
  assert.equal(canActOnEmployee(lineManager, { id: "direct-1", managerId: "mgr-1" }), true);
  assert.equal(
    canActOnEmployee(lineManager, { id: "deep-2", managerId: "direct-1" }),
    false,
    "everything below a direct report is view-only",
  );
});

test("§4.2 a manager cannot view outside their subtree", () => {
  assert.equal(canViewEmployee(lineManager, "stranger", new Set(["direct-1"])), false);
});

test("§4.2 an employee can view themselves", () => {
  assert.equal(canViewEmployee(plainEmployee, "emp-1", new Set()), true);
  assert.equal(canViewEmployee(plainEmployee, "someone-else", new Set()), false);
});

test("§4.1 HR and executives see org-wide, regardless of reporting lines", () => {
  for (const a of [hrSuperAdmin, hrbp, executive]) {
    assert.equal(hasOrgWideVisibility(a), true);
    assert.equal(canViewEmployee(a, "anyone-at-all", new Set()), true);
  }
  assert.equal(hasOrgWideVisibility(lineManager), false);
});

test("§4.1 the EXECUTIVE_VIEWER role by itself confers no action rights", () => {
  // §4.1 pins the COO/Ops Director to "Acts on: Nothing" — meaning the ROLE
  // grants nothing. Org-wide sight does not become org-wide reach: an executive
  // cannot act on someone in another manager's line.
  assert.equal(canActOnEmployee(executive, { id: "x", managerId: "someone-else" }), false);
  assert.equal(canViewEmployee(executive, "x", new Set()), true, "but they can see them");
  assert.equal(isReadOnly(executive), true);

  // Note the boundary this test does NOT claim: an executive who is ALSO
  // somebody's direct line manager does act on that person, because roles are
  // additive and most access wins (§4.3). That case is `cooWhoManages` below.
  assert.equal(
    canActOnEmployee(executive, { id: "own-report", managerId: "exec-1" }),
    true,
    "acting here comes from the reporting edge, not from EXECUTIVE_VIEWER",
  );
});

// --- §4.3 additive roles ----------------------------------------------------

test("§4.3 roles are additive — the COO who manages a team is not read-only", () => {
  // "Do not invent hybrid roles — stack the standard ones." The COO holds
  // EXECUTIVE_VIEWER and has direct reports; most access wins.
  assert.equal(isReadOnly(cooWhoManages), false);
  assert.equal(hasOrgWideVisibility(cooWhoManages), true, "still sees everything");
  assert.equal(
    canActOnEmployee(cooWhoManages, { id: "report-1", managerId: "coo-1" }),
    true,
    "still acts on their own reports",
  );
  assert.equal(
    canActOnEmployee(cooWhoManages, { id: "stranger", managerId: "someone-else" }),
    false,
    "but on nobody else's",
  );
});

test("§4.3 an HR Super Admin who manages a team holds both, with no hybrid role", () => {
  const hrWhoManages = actor({
    employeeId: "hr-1",
    pmsRoles: ["HR_SUPER_ADMIN"],
    isLineManager: true,
  });
  assert.equal(canConfigure(hrWhoManages), true);
  assert.equal(canActOnEmployee(hrWhoManages, { id: "x", managerId: "someone-else" }), true);
});

// --- §4.1 / §10.6 / §13.5 the HRBP boundary ---------------------------------

test("§4.1 HRBP does not configure the org", () => {
  assert.equal(canConfigure(hrbp), false);
  assert.equal(canConfigure(hrSuperAdmin), true);
});

test("§10.6 only HR Super Admin runs calibration", () => {
  assert.equal(canRunCalibration(hrbp), false, "'HRBP does not touch calibration'");
  assert.equal(canRunCalibration(hrSuperAdmin), true);
});

test("§13.5 the master export is Super Admin only, not HRBP", () => {
  assert.equal(canExportMasterResults(hrbp), false);
  assert.equal(canExportMasterResults(hrSuperAdmin), true);
});

test("§3 previewing an import is open to HRBP; applying it is not", () => {
  // Checking a file is part of running the cycle; reshaping the org is not.
  assert.equal(canPreviewImport(hrbp), true);
  assert.equal(canApplyImport(hrbp), false);
  assert.equal(canApplyImport(hrSuperAdmin), true);
});

// --- ADR-065: platform admin ≠ HR authority ---------------------------------

test("an authenticated user with no employee record has no PMS authority", () => {
  const caps = capabilitiesFor(unlinked);
  assert.equal(caps.orgWide, false);
  assert.equal(caps.configure, false);
  assert.equal(caps.viewCompensation, false);
  assert.equal(caps.previewImport, false);
  assert.equal(
    canActOnEmployee(unlinked, { id: "x", managerId: null }),
    false,
    "platform administration does not confer HR authority (ADR-065)",
  );
});

test("capabilitiesFor is consistent with the individual predicates", () => {
  for (const a of [plainEmployee, lineManager, hrSuperAdmin, hrbp, executive, cooWhoManages]) {
    const caps = capabilitiesFor(a);
    assert.equal(caps.orgWide, hasOrgWideVisibility(a));
    assert.equal(caps.configure, canConfigure(a));
    assert.equal(caps.viewCompensation, canViewCompensation(a));
    assert.equal(caps.applyImport, canApplyImport(a));
    assert.equal(caps.readOnly, isReadOnly(a));
  }
});

test("§4.1 `hr` is who may RUN the cycle, and it is not `orgWide` or `!readOnly`", async () => {
  const { capabilitiesFor } = await import("../../lib/pms/permissions");

  const actor = (roles: string[], isLineManager = false) => ({
    userId: "u1",
    employeeId: "e1",
    pmsRoles: roles as never,
    isLineManager,
  });

  // The COO / Ops Director: org-wide sight, read-only throughout (§4.1).
  const executive = capabilitiesFor(actor(["EXECUTIVE_VIEWER"]));
  assert.equal(executive.orgWide, true, "sees everything");
  assert.equal(executive.hr, false, "runs nothing");

  // The same person with direct reports is NOT read-only, which is why
  // `!readOnly` was the wrong gate for an HR-only action: it would have offered
  // them buttons that always 403.
  const executiveWithReports = capabilitiesFor(actor(["EXECUTIVE_VIEWER"], true));
  assert.equal(executiveWithReports.readOnly, false);
  assert.equal(executiveWithReports.hr, false, "still runs nothing");

  // §4.3's additive roles: HRBP is HR without being Super Admin, so `configure`
  // is not a stand-in for `hr` either.
  const hrbp = capabilitiesFor(actor(["HRBP"]));
  assert.equal(hrbp.hr, true);
  assert.equal(hrbp.configure, false);

  assert.equal(capabilitiesFor(actor(["HR_SUPER_ADMIN"])).hr, true);
  assert.equal(capabilitiesFor(actor([])).hr, false);
});

// --- ADR-070: who may see the platform-administrator roster --------------------
//
// The union of the two authority systems, which is the only place in this file
// where BOTH are consulted. Asserted exhaustively rather than by example: the
// endpoint it gates returns the names of the most privileged accounts in the
// system, so "who is refused" is the property that matters, and a refusal list
// with a hole in it is the whole risk.
{
  const roster = (over: Partial<PmsActor>, platformRole: string | null | undefined) =>
    canSeePlatformAdminRoster(
      { userId: "u", employeeId: "e", pmsRoles: [], isLineManager: false, ...over },
      platformRole,
    );

  test("ADR-070 roster: an HR Super Admin may see it even with no platform role", () => {
    assert.equal(roster({ pmsRoles: ["HR_SUPER_ADMIN"] }, "VIEWER"), true);
    // The audience the endpoint exists for: cannot grant platform admin, needs
    // to know whom to ask.
    assert.equal(roster({ pmsRoles: ["HR_SUPER_ADMIN"] }, null), true);
  });

  test("ADR-070 roster: a platform ADMIN may see it with no HR role at all", () => {
    // The bootstrap admin has no employee record, hence no pmsRoles.
    assert.equal(roster({ employeeId: null }, "ADMIN"), true);
  });

  test("ADR-070 roster: every other authenticated shape is REFUSED", () => {
    assert.equal(roster({}, "VIEWER"), false, "ordinary employee");
    assert.equal(roster({}, null), false, "no platform role at all");
    assert.equal(roster({ isLineManager: true }, "VIEWER"), false, "line manager");
    // §4.1 marks HRBP "Configures? No" — the roster is an administration
    // question, not a cycle-running one.
    assert.equal(roster({ pmsRoles: ["HRBP"] }, "VIEWER"), false, "HRBP");
    // §4.1 gives the executive viewer org-wide READ of performance data, which
    // is a different surface from who administers the platform.
    assert.equal(roster({ pmsRoles: ["EXECUTIVE_VIEWER"] }, "VIEWER"), false, "executive viewer");
    assert.equal(
      roster({ pmsRoles: ["HRBP", "EXECUTIVE_VIEWER"] }, "VIEWER"),
      false,
      "both, still no",
    );
  });

  test("ADR-070 roster: the platform check is exact, never truthiness", () => {
    // A stale JWT issued before the enum retirement can still carry the old
    // value; it must not be mistaken for administration.
    assert.equal(roster({}, "EDITOR"), false);
    assert.equal(roster({}, "admin"), false, "case-sensitive");
    assert.equal(roster({}, ""), false);
    assert.equal(roster({}, undefined), false);
  });
}
