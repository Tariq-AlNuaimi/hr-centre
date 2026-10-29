// ADR-069 amendment (operator, 2026-08-26) — off-boarding revokes access.
//
// DB-backed, because the property is about rows and about the soft-delete
// extension's own rewrite of `delete`. Not part of `npm test`; run with:
//   npm run test:integration
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { prisma, prismaUnfiltered, auditedTransaction } from "../../lib/prisma";
import { withAuditContext } from "../../lib/audit-context";
import { revokeLoginOnOffboard } from "../../lib/pms/offboarding";
import { employeeSelect, serializeEmployee } from "../../lib/core/employee-select";

const RUN = `offb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const email = (l: string) => `${RUN}.${l}@example.test`;
const odoo = (l: string) => `ZZOFFB-${RUN}-${l}`.slice(0, 60);

let dbReachable = false;
let entityId = "";
let departmentId = "";
try {
  await prismaUnfiltered.$queryRaw`SELECT 1`;
  const d = await prismaUnfiltered.department.findFirstOrThrow({
    select: { id: true, entityId: true },
  });
  departmentId = d.id;
  entityId = d.entityId;
  dbReachable = true;
} catch {
  dbReachable = false;
}

const createdEmployees: string[] = [];
const createdUsers: string[] = [];

/** An employee with a linked login, in the shape the import leaves behind. */
async function employeeWithLogin(label: string) {
  const user = await prismaUnfiltered.user.create({
    data: { email: email(label), name: `Off ${label}`, role: "VIEWER" },
    select: { id: true },
  });
  createdUsers.push(user.id);
  const employee = await prismaUnfiltered.employee.create({
    data: {
      odooId: odoo(label),
      name: `Off ${label}`,
      email: email(label),
      entityId,
      departmentId,
      roleTrack: "INDIVIDUAL",
      status: "ACTIVE",
      userId: user.id,
    },
    select: { id: true },
  });
  createdEmployees.push(employee.id);
  return { employeeId: employee.id, userId: user.id };
}

test(
  "off-boarding SOFT-DELETES the linked login, and leaves the employee record intact",
  { skip: !dbReachable && "no reachable DATABASE_URL" },
  async () => {
    const { employeeId, userId } = await employeeWithLogin("live");

    const revoked = await withAuditContext({}, () =>
      auditedTransaction((tx) => revokeLoginOnOffboard(tx, employeeId)),
    );
    assert.equal(revoked, userId, "the helper reports WHICH login it revoked");

    const user = await prismaUnfiltered.user.findUniqueOrThrow({
      where: { id: userId },
      select: { deletedAt: true },
    });
    // A soft delete, not a hard one: /recycling-bin restores it, so an
    // off-boarding done in error is a restore rather than a re-creation — and
    // the audit trail stays attached to the same id.
    assert.notEqual(user.deletedAt, null, "the account is revoked");

    // §12.1 — the RECORD is preserved. The link stays too: it is how a restored
    // account finds its way back.
    const employee = await prismaUnfiltered.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { userId: true, name: true },
    });
    assert.equal(employee.userId, userId, "the employee is not orphaned");
    assert.ok(employee.name, "and the record is still there");

    // The security property: the audited client can no longer see the account,
    // which is the same filter `authorize()` applies at sign-in.
    const visible = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    assert.equal(visible, null, "sign-in can no longer find it");
  },
);

test(
  "an employee with NO login off-boards quietly rather than erroring",
  { skip: !dbReachable && "no reachable DATABASE_URL" },
  async () => {
    // Most of the fixture is in this state, and a no-op must stay a no-op —
    // a departure that 500s because the person never had an account would make
    // the revocation worse than not having it.
    const employee = await prismaUnfiltered.employee.create({
      data: {
        odooId: odoo("nologin"),
        name: "No Login",
        email: email("nologin"),
        entityId,
        departmentId,
        roleTrack: "INDIVIDUAL",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    createdEmployees.push(employee.id);

    const revoked = await withAuditContext({}, () =>
      auditedTransaction((tx) => revokeLoginOnOffboard(tx, employee.id)),
    );
    assert.equal(revoked, null);
  },
);

test(
  "revoking twice is quiet — a second departure is not an error",
  { skip: !dbReachable && "no reachable DATABASE_URL" },
  async () => {
    const { employeeId } = await employeeWithLogin("twice");
    await withAuditContext({}, () =>
      auditedTransaction((tx) => revokeLoginOnOffboard(tx, employeeId)),
    );
    // A re-import that still lists last year's leaver must not throw. The
    // already-soft-deleted row is invisible to the extension's own read filter,
    // so the second delete would raise P2025 if it were not swallowed.
    const second = await withAuditContext({}, () =>
      auditedTransaction((tx) => revokeLoginOnOffboard(tx, employeeId)),
    );
    assert.equal(second, null);
  },
);

test(
  "a revoked employee reads as REVOKED, not as 'has a login' and not as 'never had one'",
  { skip: !dbReachable && "no reachable DATABASE_URL" },
  async () => {
    // The regression a breadth review caught: off-boarding keeps `Employee.userId`
    // pointed at the soft-deleted `User` (so a restore can find its way back), and
    // `hasLogin` was derived from that id alone — so /admin/roles showed a green
    // "Has login" badge for someone who could not sign in at all. On the one
    // screen built to answer exactly that question.
    const { employeeId } = await employeeWithLogin("state");

    const hrActor = {
      employeeId: null,
      pmsRoles: [],
      capabilities: {
        orgWide: true,
        hr: true,
        configure: true,
        viewCompensation: false,
        previewImport: true,
        applyImport: true,
      },
    } as unknown as Parameters<typeof employeeSelect>[0];

    const before = await prismaUnfiltered.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: employeeSelect(hrActor),
    });
    assert.equal(serializeEmployee(before).loginState, "ACTIVE");

    await withAuditContext({}, () =>
      auditedTransaction((tx) => revokeLoginOnOffboard(tx, employeeId)),
    );

    const after = await prismaUnfiltered.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: employeeSelect(hrActor),
    });
    // REVOKED, not NONE: the two have different remedies. An account that never
    // existed is created; a revoked one is RESTORED from the recycling bin, and
    // creating a second on that email is refused by the unique index.
    assert.equal(serializeEmployee(after).loginState, "REVOKED");
  },
);

test(
  "an employee who never had an account reads as NONE",
  { skip: !dbReachable && "no reachable DATABASE_URL" },
  async () => {
    const employee = await prismaUnfiltered.employee.create({
      data: {
        odooId: odoo("never"),
        name: "Never Had One",
        email: email("never"),
        entityId,
        departmentId,
        roleTrack: "INDIVIDUAL",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    createdEmployees.push(employee.id);

    const hrActor = {
      employeeId: null,
      pmsRoles: [],
      capabilities: {
        orgWide: true,
        hr: true,
        configure: true,
        viewCompensation: false,
        previewImport: true,
        applyImport: true,
      },
    } as unknown as Parameters<typeof employeeSelect>[0];

    const row = await prismaUnfiltered.employee.findUniqueOrThrow({
      where: { id: employee.id },
      select: employeeSelect(hrActor),
    });
    assert.equal(serializeEmployee(row).loginState, "NONE");
  },
);

after(async () => {
  if (!dbReachable) return;
  await prismaUnfiltered.employee.deleteMany({ where: { id: { in: createdEmployees } } });
  await prismaUnfiltered.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});
