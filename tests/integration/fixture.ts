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
    pmsRoles?: import("../../generated/prisma/client").PmsRole[];
    managerId?: string | null;
  },
): Promise<string> {
  const { suite, tag, name, pmsRoles = [], managerId = null } = params;
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
      pmsRoles,
      // The schema CHECK-constrains a joining date to at most a year ahead, so a
      // future-dated fixture is a fixture with a shelf life.
      dateOfJoining: new Date(Date.UTC(2020, 0, 1)),
    },
    update: { pmsRoles, status: "ACTIVE", managerId, lastWorkingDay: null },
    select: { id: true },
  });
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
  const employee = await prisma.employee.update({
    where: { id: employeeId },
    data: { userId: user.id },
    select: { pmsRoles: true },
  });
  // HR Centre F-c: authority is role assignments now. Suites still describe
  // their actors with pmsRoles; mirror them as Group assignments of the
  // matching starter role (created by migration 20261026180000).
  await prisma.roleAssignment.deleteMany({ where: { userId: user.id } });
  for (const key of employee.pmsRoles) {
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
