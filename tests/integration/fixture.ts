/**
 * Shared conventions for the DB-backed integration suites.
 *
 * Node's test runner runs test FILES concurrently against one database, so two
 * suites can interfere in ways that look like application bugs:
 *
 *  - **Actor contention.** `Employee.userId` is UNIQUE. Two suites that both log
 *    in as the one seeded HR Super Admin race for that column, and whichever
 *    `before` hook lands second leaves the other's actor pointing at a user with
 *    no employee record — a 403 on a test that passes in isolation.
 *  - **Arbitrary-pick contention.** A suite that grabs "any employee with no
 *    roles and no reports" can pick an employee ANOTHER suite is actively
 *    mutating (making them a leaver, moving their manager, splitting their
 *    year), and then asserts against a chain that changed underneath it.
 *
 * Both are solved the same way: a suite OWNS the employees it mutates, gives
 * them this prefix, and every arbitrary pick excludes the prefix. A suite that
 * needs "some ordinary employee from the fixture" then reliably gets one.
 */

import type { PmsRole } from "../../lib/core/permissions";

/** Every employee an integration suite creates for itself carries this prefix. */
export const TEST_EMPLOYEE_PREFIX = "ZZTEST-";

/**
 * A `where` fragment excluding suite-owned employees.
 *
 * Spread into any query that picks an ARBITRARY employee out of the seeded
 * fixture — never into one that targets an employee by id.
 */
export const NOT_SUITE_OWNED = { odooId: { not: { startsWith: TEST_EMPLOYEE_PREFIX } } };

/**
 * Create (or refresh) an employee this suite OWNS, carrying the prefix above.
 *
 * Use for every actor a suite logs in as. Borrowing the seeded HR Super Admin
 * instead is what produces the actor contention described above: the column that
 * links an Employee to a User is unique, so only one suite can hold it, and the
 * loser fails with a 403 that has nothing to do with the code under test.
 *
 * `prisma` is passed in rather than imported because each suite imports it after
 * installing its own auth mock.
 */
export async function suiteActor(
  prisma: typeof import("../../lib/prisma").prisma,
  params: {
    suite: string;
    tag: string;
    name: string;
    starterRoles?: PmsRole[];
    managerId?: string | null;
  },
): Promise<string> {
  const { suite, tag, name, starterRoles = [], managerId = null } = params;
  const odooId = `${TEST_EMPLOYEE_PREFIX}${suite}-${tag}`;
  const entity = await prisma.orgEntity.findFirstOrThrow({ select: { id: true } });
  const department = await prisma.department.findFirstOrThrow({
    where: { entityId: entity.id },
    select: { id: true },
  });
  const row = await prisma.employee.upsert({
    where: { odooId },
    create: {
      odooId,
      name,
      email: `${odooId.toLowerCase()}@suite.test`,
      departmentId: department.id,
      entityId: entity.id,
      managerId,
      roleTrack: "INDIVIDUAL",
      status: "ACTIVE",
      // The schema CHECK-constrains a joining date to at most a year ahead, so a
      // future-dated fixture is a fixture with a shelf life.
      dateOfJoining: new Date(Date.UTC(2020, 0, 1)),
    },
    update: { status: "ACTIVE", managerId, lastWorkingDay: null },
    select: { id: true },
  });
  describeRoles(row.id, starterRoles);
  return row.id;
}

/**
 * Link a suite-owned employee to a suite-owned User, and return the user id.
 *
 * The `updateMany` clears the link from any OTHER employee currently holding
 * this user — needed because a suite can re-point the same login across runs.
 */
export async function suiteLogin(
  prisma: typeof import("../../lib/prisma").prisma,
  params: { suite: string; tag: string; employeeId: string },
): Promise<string> {
  const { suite, tag, employeeId } = params;
  const email = `${suite}-${tag}@suite.test`.toLowerCase();
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: `${suite} ${tag}`, role: "VIEWER" },
    update: {},
    select: { id: true },
  });
  await prisma.employee.updateMany({
    where: { userId: user.id, NOT: { id: employeeId } },
    data: { userId: null },
  });
  await prisma.employee.update({
    where: { id: employeeId },
    data: { userId: user.id },
    select: { id: true },
  });
  // HR Centre F-c: authority is role assignments. The suite described this
  // actor's starter roles (`describeRoles`); grant them at Group scope.
  await prisma.roleAssignment.deleteMany({ where: { userId: user.id } });
  for (const key of suiteRoles.get(employeeId) ?? []) {
    const role = await prisma.accessRole.findFirst({
      where: { starterKey: key },
      select: { id: true },
    });
    if (role) {
      await prisma.roleAssignment.create({
        data: { userId: user.id, roleId: role.id, scopeType: "GROUP", note: "integration fixture" },
        select: { id: true },
      });
    }
  }
  return user.id;
}

/**
 * The starter roles each suite-described employee should hold, per process
 * (each suite file runs in its own). `Employee.pmsRoles` used to carry this; the
 * column is gone, so the suites describe their actors here instead.
 */
const suiteRoles = new Map<string, PmsRole[]>();

/** Record which starter roles this employee's login should hold. */
export function describeRoles(employeeId: string, roles: readonly PmsRole[]): void {
  suiteRoles.set(employeeId, [...roles]);
}

/**
 * "Holds no HR role" — the filter suites use to pick a plain employee from the
 * seeded fixture (it used to be `pmsRoles: { isEmpty: true }`).
 */
export const NO_HR_ROLE = { NOT: { user: { roleAssignments: { some: {} } } } };

/**
 * Without this every HR actor answered 403/404 and ~50 security tests proved
 * nothing (QA 2026-10-27). Call once at the end of a suite's `before`: every
 * login-linked employee the suite described gets its starter roles as GROUP
 * assignments. Additive and idempotent (find, then create); fixture rows whose
 * role the employee no longer lists are withdrawn.
 */
export async function syncFixtureRoles(
  prisma: typeof import("../../lib/prisma").prisma,
): Promise<number> {
  const starters = await prisma.accessRole.findMany({
    where: { starterKey: { not: null } },
    select: { id: true, starterKey: true },
  });
  const roleFor = new Map(starters.map((r) => [r.starterKey!, r.id]));
  if (roleFor.size === 0) {
    throw new Error(
      "No starter roles in the database: run `prisma migrate deploy` and `SEED_DEMO=1 prisma db seed` first.",
    );
  }
  const linked = await prisma.employee.findMany({
    where: { id: { in: [...suiteRoles.keys()] }, userId: { not: null } },
    select: { id: true, userId: true },
    take: 2000,
  });
  let created = 0;
  for (const e of linked) {
    const roles = suiteRoles.get(e.id) ?? [];
    const want = new Set(roles.map((k) => roleFor.get(k)).filter((x): x is string => !!x));
    const have = await prisma.roleAssignment.findMany({
      where: { userId: e.userId!, scopeType: "GROUP" },
      select: { id: true, roleId: true, note: true },
    });
    for (const roleId of want) {
      if (have.some((h) => h.roleId === roleId)) continue;
      await prisma.roleAssignment.create({
        data: { userId: e.userId!, roleId, scopeType: "GROUP", note: "integration fixture" },
        select: { id: true },
      });
      created += 1;
    }
    for (const h of have) {
      if (h.note === "integration fixture" && !want.has(h.roleId)) {
        await prisma.roleAssignment.delete({ where: { id: h.id }, select: { id: true } });
      }
    }
  }
  return created;
}
