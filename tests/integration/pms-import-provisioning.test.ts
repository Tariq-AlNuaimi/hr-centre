// ADR-069 — applying an employee import must give each new employee a way in.
//
// DB-backed, because the property is about rows: a `User` created, linked, with
// NO password, at VIEWER, and idempotent across a re-import (§3.5 makes
// re-importing routine). Not part of `npm test`; run with:
//   npm run test:integration
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { prisma, prismaUnfiltered, auditedTransaction } from "../../lib/prisma";
import { withAuditContext } from "../../lib/audit-context";
import { provisionLogin } from "../../lib/pms/import/run";

const RUN = `prov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
/** Stand-in for a stored password hash. See the note at its use site. */
const NOT_A_HASH = "this is not a password hash";
const email = (l: string) => `${RUN}.${l}@example.test`;
const odoo = (l: string) => `ZZPROV-${RUN}-${l}`.slice(0, 60);

let dbReachable = false;
// §1.2 is enforced in the DATABASE, not only in zod: a non-C-Level employee
// must carry a department, and `entityId` must agree with that department's own
// (composite FK). So the fixture takes both from one real department rather
// than picking an entity and hoping — a placement that would be refused by the
// constraint is not a fixture the import could ever produce either.
let entityId = "";
let departmentId = "";
try {
  await prismaUnfiltered.$queryRaw`SELECT 1`;
  const department = await prismaUnfiltered.department.findFirstOrThrow({
    select: { id: true, entityId: true },
  });
  departmentId = department.id;
  entityId = department.entityId;
  dbReachable = true;
} catch {
  dbReachable = false;
}

const createdEmployees: string[] = [];
const createdUsers: string[] = [];

/**
 * The provisioning behaviour under test, exercised through the same shape the
 * import uses: inside `auditedTransaction`, creating the employee then the login.
 * `applyImport` itself needs a real .xlsx round-trip, which is `pms-import`'s
 * job; what is under test HERE is the rule, not the spreadsheet parser.
 */
async function importOne(opts: { label: string; status: "ACTIVE" | "LEAVER" }) {
  return withAuditContext({}, async () =>
    auditedTransaction(async (tx) => {
      const e = await tx.employee.create({
        data: {
          odooId: odoo(opts.label),
          name: `Provision ${opts.label}`,
          email: email(opts.label),
          entityId,
          departmentId,
          roleTrack: "INDIVIDUAL",
          status: opts.status,
          ...(opts.status === "LEAVER" ? { lastWorkingDay: new Date("2026-06-30") } : {}),
        },
        select: { id: true, email: true, name: true, status: true },
      });
      createdEmployees.push(e.id);
      // The SHIPPED function, not a restatement of it: a fixture that reimplements
      // the rule would keep passing after the import stopped calling it.
      const provisioned = await provisionLogin(tx, e);
      return { employeeId: e.id, provisioned };
    }),
  );
}

test(
  "ADR-069 an imported employee gets a linked, PASSWORDLESS, VIEWER login",
  { skip: !dbReachable && "no reachable DATABASE_URL" },
  async () => {
    const { employeeId } = await importOne({ label: "active", status: "ACTIVE" });

    const employee = await prismaUnfiltered.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { userId: true, email: true },
    });
    assert.ok(employee.userId, "the link is written at creation, not left to first-login matching");

    const user = await prismaUnfiltered.user.findUniqueOrThrow({
      where: { id: employee.userId },
      select: { email: true, role: true, passwordHash: true },
    });
    assert.equal(user.email, employee.email.toLowerCase());

    // The security property. `authorize()` returns null for an account with no
    // hash, so credentials sign-in is IMPOSSIBLE here rather than weakly
    // possible. A random password would be a real secret nobody would ever be
    // told — able to leak, unable to help.
    assert.equal(user.passwordHash, null, "a provisioned account must have NO password");

    // Appearing in an HR spreadsheet must never mint a platform administrator.
    // §4.1's HR authority is a separate, deliberate grant at /admin/roles.
    assert.equal(user.role, "VIEWER");
  },
);

test(
  "§12.1 a LEAVER is imported without a login",
  { skip: !dbReachable && "no reachable DATABASE_URL" },
  async () => {
    const { employeeId, provisioned } = await importOne({ label: "leaver", status: "LEAVER" });
    assert.equal(provisioned, false);
    const employee = await prismaUnfiltered.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { userId: true },
    });
    // §12.1 preserves a leaver's RECORD and history — not their access. Minting a
    // login for someone who has left is the opposite of an off-boarding step.
    assert.equal(employee.userId, null);
  },
);

test(
  "§3.5 a re-import never disturbs an existing login",
  { skip: !dbReachable && "no reachable DATABASE_URL" },
  async () => {
    // Someone whose account was made by hand first — with a password and a
    // higher role — must survive the import untouched.
    const handMade = await prismaUnfiltered.user.create({
      data: {
        email: email("rerun"),
        name: "Hand Made",
        role: "ADMIN",
        // Not a hash, and deliberately not hash-SHAPED either: a realistic-looking
        // digest literal here trips the repo's gitleaks gate as a generic
        // high-entropy secret, and a false positive on every push is how a real
        // one eventually gets waved through.
        passwordHash: NOT_A_HASH,
      },
      select: { id: true },
    });
    createdUsers.push(handMade.id);

    const { provisioned } = await importOne({ label: "rerun", status: "ACTIVE" });
    assert.equal(provisioned, false, "an email that already has a login is skipped");

    const after = await prismaUnfiltered.user.findUniqueOrThrow({
      where: { id: handMade.id },
      select: { role: true, passwordHash: true },
    });
    assert.equal(after.role, "ADMIN", "the import must not demote an existing account");
    assert.equal(after.passwordHash, NOT_A_HASH, "and must never reset a password");
  },
);

test(
  "a SOFT-DELETED account does not collide, and is not resurrected",
  { skip: !dbReachable && "no reachable DATABASE_URL" },
  async () => {
    // Off-boarded: the `User` row still exists and still occupies the unique
    // email index, but every audited read filters it out. A provisioning check
    // that cannot see it would create a second row on the same email and take
    // the WHOLE import down with a unique-constraint violation.
    const revoked = await prismaUnfiltered.user.create({
      data: {
        email: email("revoked"),
        name: "Off Boarded",
        role: "VIEWER",
        deletedAt: new Date(),
      },
      select: { id: true },
    });
    createdUsers.push(revoked.id);

    const { employeeId, provisioned } = await importOne({ label: "revoked", status: "ACTIVE" });
    assert.equal(provisioned, false, "the import must not create a second row on that email");

    // And must not RE-LINK: revoked access is a decision a person made, and a
    // re-hire appearing in a spreadsheet is not the undoing of it.
    const employee = await prismaUnfiltered.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { userId: true },
    });
    assert.equal(employee.userId, null);

    const stillOne = await prismaUnfiltered.user.count({ where: { email: email("revoked") } });
    assert.equal(stillOne, 1);
  },
);

after(async () => {
  if (!dbReachable) return;
  await prismaUnfiltered.employee.deleteMany({ where: { id: { in: createdEmployees } } });
  // By id for the hand-made account, and by this run's email prefix for whatever
  // `provisionLogin` minted — the fixture no longer knows those ids, and a leaked
  // User row would collide with the unique email index on the next run.
  await prismaUnfiltered.user.deleteMany({
    where: { OR: [{ id: { in: createdUsers } }, { email: { startsWith: `${RUN}.` } }] },
  });
  await prisma.$disconnect();
});
