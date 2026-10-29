import type { PrismaClient, RoleTrack } from "../generated/prisma/client";
import type { PmsRole } from "../lib/pms/permissions";
import { encryptSalary } from "../lib/pms/employee-select";

/**
 * PMS org fixture — spec §1.2 (three entities), §1.3 (five role tracks),
 * §4.1 (the role set).
 *
 * Called from prisma/seed.ts. Idempotent: every insert is a
 * findUnique-then-create, so re-seeding an existing database is a no-op rather
 * than a duplicate-key crash. (`upsert` would trip `no-unaudited-bulk-write`.)
 *
 * The shape is deliberately realistic rather than minimal — three entities,
 * eleven departments, a reporting tree four levels deep, and every role track
 * represented — because the things most likely to be wrong are the ones a toy
 * fixture cannot exercise: a manager seeing three levels down (§4.2), a
 * department name that repeats across entities (§1.2), a C-Level with no
 * department, and salary being absent from a line manager's payload (§4.5).
 */

type SeedDept = { name: string; entity: string };
type SeedEmployee = {
  odooId: string;
  name: string;
  email: string;
  department: string | null;
  entity: string;
  manager: string | null;
  roleTrack: RoleTrack;
  /** Starter roles granted at Group scope once the login exists (prisma/seed.ts). */
  starterRoles?: PmsRole[];
  basicSalary: string;
  /**
   * §3.3 — months BEFORE the seed runs, not an ISO date.
   *
   * A literal date was the obvious choice and the wrong one: the migration
   * CHECK-constrains a joining date to at most a year ahead ("a joining date in
   * the future is a typo"), so a hard-coded future date makes the whole seed
   * unrunnable the moment the wall clock catches up — which it did. An offset
   * keeps §11.2's six-month gate making a REAL decision at any point in time,
   * which is the only reason the fixture varies these dates at all.
   *
   * Omitted rows fall back to a long-tenured default.
   */
  joinedMonthsAgo?: number;
  unpaidLeaveDays?: number;
};

/**
 * A joining date N months before today, as a UTC calendar date.
 *
 * Relative rather than literal so the fixture stays valid — and stays MEANINGFUL
 * — however long after it was written the seed runs. `undefined` means the
 * long-tenured default: five years back, comfortably clear of every gate.
 */
function joiningDate(monthsAgo: number | undefined): Date {
  const now = new Date();
  const months = monthsAgo ?? 60;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, Math.min(now.getUTCDate(), 28)),
  );
}

/** §1.2 — Rihal (parent), TP and CL (subsidiaries). */
const ENTITIES = [
  { code: "RIHAL", name: "Rihal" },
  { code: "TP", name: "TP" },
  { code: "CL", name: "CL" },
];

/**
 * §1.2 — "Central/shared-service functions (HR, Finance, Admin, IT and similar)
 * exist only in Rihal." Note Sales appears under all three entities: they are
 * three DISTINCT departments, which is what the composite unique enforces and
 * what makes an entity-less "Sales" ambiguous on import.
 */
const DEPARTMENTS: SeedDept[] = [
  { name: "HR", entity: "RIHAL" },
  { name: "Finance", entity: "RIHAL" },
  { name: "IT", entity: "RIHAL" },
  { name: "Marketing", entity: "RIHAL" },
  { name: "Engineering", entity: "RIHAL" },
  { name: "Sales", entity: "RIHAL" },
  { name: "Sales", entity: "TP" },
  { name: "Delivery", entity: "TP" },
  { name: "Sales", entity: "CL" },
  { name: "Operations", entity: "CL" },
  { name: "Support", entity: "CL" },
];

/** The demo fixture. Exported for `grantDemoRoles` (prisma/seed.ts). */
export const EMPLOYEES: SeedEmployee[] = [
  // --- C-Level (§1.2: entity directly, no department; §8.3: no formula) ------
  {
    odooId: "1000",
    name: "Salim Al-Harthy",
    email: "salim.alharthy@rihal.example",
    department: null,
    entity: "RIHAL",
    manager: null,
    roleTrack: "C_LEVEL",
    basicSalary: "6000",
  },
  {
    odooId: "1001",
    name: "Amina Al-Balushi",
    email: "amina.albalushi@rihal.example",
    department: null,
    entity: "RIHAL",
    manager: "1000",
    roleTrack: "C_LEVEL",
    // §4.3 — additive: the COO is an executive viewer who ALSO has reports.
    // There is no "COO" role; the two standard ones are stacked.
    starterRoles: ["EXECUTIVE_VIEWER"],
    basicSalary: "5500",
  },
  {
    odooId: "1002",
    name: "Khalid Al-Zadjali",
    email: "khalid.alzadjali@rihal.example",
    department: null,
    entity: "TP",
    manager: "1000",
    roleTrack: "C_LEVEL",
    basicSalary: "5200",
  },
  {
    odooId: "1003",
    name: "Maha Al-Kindi",
    email: "maha.alkindi@rihal.example",
    department: null,
    entity: "CL",
    manager: "1000",
    roleTrack: "C_LEVEL",
    basicSalary: "5200",
  },

  // --- HR (Rihal shared service) --------------------------------------------
  {
    odooId: "1100",
    name: "Fatma Al-Rashdi",
    email: "fatma.alrashdi@rihal.example",
    department: "HR",
    entity: "RIHAL",
    manager: "1001",
    roleTrack: "DIRECTOR",
    starterRoles: ["HR_SUPER_ADMIN"],
    basicSalary: "3200",
  },
  {
    odooId: "1101",
    name: "Yousuf Al-Amri",
    email: "yousuf.alamri@rihal.example",
    department: "HR",
    entity: "RIHAL",
    manager: "1100",
    roleTrack: "MANAGER",
    starterRoles: ["HRBP"],
    basicSalary: "2400",
  },
  {
    odooId: "1102",
    name: "Noura Al-Siyabi",
    email: "noura.alsiyabi@rihal.example",
    department: "HR",
    entity: "RIHAL",
    manager: "1101",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1200",
  },

  // --- Ops Director (§4.1: org-wide read-only, sees salary) ------------------
  {
    odooId: "1110",
    name: "Hamed Al-Maskari",
    email: "hamed.almaskari@rihal.example",
    department: "Finance",
    entity: "RIHAL",
    manager: "1001",
    roleTrack: "DIRECTOR",
    starterRoles: ["EXECUTIVE_VIEWER"],
    basicSalary: "3400",
  },
  {
    odooId: "1111",
    name: "Aisha Al-Hinai",
    email: "aisha.alhinai@rihal.example",
    department: "Finance",
    entity: "RIHAL",
    manager: "1110",
    roleTrack: "LEAD",
    basicSalary: "1900",
  },

  // --- Engineering: a four-level chain, for §4.2 depth ----------------------
  {
    odooId: "1200",
    name: "Tariq Al-Naaimi",
    email: "tariq.alnaaimi@rihal.example",
    department: "Engineering",
    entity: "RIHAL",
    manager: "1001",
    roleTrack: "DIRECTOR",
    basicSalary: "3600",
  },
  {
    odooId: "1201",
    name: "Rashid Al-Farsi",
    email: "rashid.alfarsi@rihal.example",
    department: "Engineering",
    entity: "RIHAL",
    manager: "1200",
    roleTrack: "MANAGER",
    basicSalary: "2600",
  },
  {
    odooId: "1202",
    name: "Layla Al-Habsi",
    email: "layla.alhabsi@rihal.example",
    department: "Engineering",
    entity: "RIHAL",
    manager: "1201",
    roleTrack: "LEAD",
    basicSalary: "2000",
  },
  {
    odooId: "1203",
    name: "Omar Al-Busaidi",
    email: "omar.albusaidi@rihal.example",
    department: "Engineering",
    entity: "RIHAL",
    manager: "1202",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1300",
  },
  {
    odooId: "1204",
    name: "Zainab Al-Lawati",
    email: "zainab.allawati@rihal.example",
    department: "Engineering",
    entity: "RIHAL",
    manager: "1202",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1250",
    // §11.5 — unpaid leave reduces both pro-ration and effective service.
    unpaidLeaveDays: 12,
  },
  {
    odooId: "1205",
    name: "Badar Al-Riyami",
    email: "badar.alriyami@rihal.example",
    department: "Engineering",
    entity: "RIHAL",
    manager: "1201",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1350",
    // §11.2 — under the six-month gate, so it has a real decision to make
    // rather than passing everyone in the fixture trivially.
    joinedMonthsAgo: 4,
  },

  // --- Rihal Marketing & Sales ---------------------------------------------
  {
    odooId: "1300",
    name: "Huda Al-Mahrouqi",
    email: "huda.almahrouqi@rihal.example",
    department: "Marketing",
    entity: "RIHAL",
    manager: "1001",
    roleTrack: "MANAGER",
    basicSalary: "2500",
  },
  {
    odooId: "1301",
    name: "Saif Al-Wahaibi",
    email: "saif.alwahaibi@rihal.example",
    department: "Marketing",
    entity: "RIHAL",
    manager: "1300",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1150",
  },
  {
    odooId: "1310",
    name: "Muna Al-Shukaili",
    email: "muna.alshukaili@rihal.example",
    department: "Sales",
    entity: "RIHAL",
    manager: "1001",
    roleTrack: "MANAGER",
    basicSalary: "2450",
    // Operator decision, 2026-08-26: "Muna → MANAGER track, HR_SUPER_ADMIN".
    // The track was already MANAGER, so the role is the only change.
    //
    // NAME CHECK: the decision was written as "Muna Adam"; this is the only Muna
    // in the fixture. If a different person was meant, this is the line to move —
    // and it matters more than a typo usually would, because §4.1 gives
    // HR_SUPER_ADMIN the configure column, §10.6's calibration, §13.2's publish
    // and §13.5's master export, and this fixture is going to production.
    starterRoles: ["HR_SUPER_ADMIN"],
  },
  {
    odooId: "1311",
    name: "Ali Al-Ghafri",
    email: "ali.alghafri@rihal.example",
    department: "Sales",
    entity: "RIHAL",
    manager: "1310",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1180",
  },
  {
    odooId: "1320",
    name: "Salma Al-Hajri",
    email: "salma.alhajri@rihal.example",
    department: "IT",
    entity: "RIHAL",
    manager: "1200",
    roleTrack: "LEAD",
    basicSalary: "1950",
  },
  {
    odooId: "1321",
    name: "Nasser Al-Abri",
    email: "nasser.alabri@rihal.example",
    department: "IT",
    entity: "RIHAL",
    manager: "1320",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1220",
  },

  // --- TP -------------------------------------------------------------------
  {
    odooId: "2000",
    name: "Ibrahim Al-Sinani",
    email: "ibrahim.alsinani@tp.example",
    department: "Sales",
    entity: "TP",
    manager: "1002",
    roleTrack: "DIRECTOR",
    basicSalary: "3100",
  },
  {
    odooId: "2001",
    name: "Reem Al-Jabri",
    email: "reem.aljabri@tp.example",
    department: "Sales",
    entity: "TP",
    manager: "2000",
    roleTrack: "MANAGER",
    basicSalary: "2300",
  },
  {
    odooId: "2002",
    name: "Faisal Al-Rawahi",
    email: "faisal.alrawahi@tp.example",
    department: "Sales",
    entity: "TP",
    manager: "2001",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1100",
  },
  {
    odooId: "2003",
    name: "Hanan Al-Saadi",
    email: "hanan.alsaadi@tp.example",
    department: "Sales",
    entity: "TP",
    manager: "2001",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1120",
  },
  {
    odooId: "2010",
    name: "Sultan Al-Harrasi",
    email: "sultan.alharrasi@tp.example",
    department: "Delivery",
    entity: "TP",
    manager: "1002",
    roleTrack: "MANAGER",
    basicSalary: "2350",
  },
  {
    odooId: "2011",
    name: "Widad Al-Nabhani",
    email: "widad.alnabhani@tp.example",
    department: "Delivery",
    entity: "TP",
    manager: "2010",
    roleTrack: "LEAD",
    basicSalary: "1850",
  },
  {
    odooId: "2012",
    name: "Majid Al-Kaabi",
    email: "majid.alkaabi@tp.example",
    department: "Delivery",
    entity: "TP",
    manager: "2011",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1080",
  },

  // --- CL -------------------------------------------------------------------
  {
    odooId: "3000",
    name: "Ghalia Al-Rasbi",
    email: "ghalia.alrasbi@cl.example",
    department: "Operations",
    entity: "CL",
    manager: "1003",
    roleTrack: "DIRECTOR",
    basicSalary: "3050",
  },
  {
    odooId: "3001",
    name: "Talal Al-Mamari",
    email: "talal.almamari@cl.example",
    department: "Operations",
    entity: "CL",
    manager: "3000",
    roleTrack: "MANAGER",
    basicSalary: "2280",
  },
  {
    odooId: "3002",
    name: "Sara Al-Battashi",
    email: "sara.albattashi@cl.example",
    department: "Operations",
    entity: "CL",
    manager: "3001",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1060",
  },
  {
    odooId: "3010",
    name: "Hilal Al-Yahyai",
    email: "hilal.alyahyai@cl.example",
    department: "Sales",
    entity: "CL",
    manager: "1003",
    roleTrack: "MANAGER",
    basicSalary: "2320",
  },
  {
    odooId: "3011",
    name: "Buthaina Al-Azri",
    email: "buthaina.alazri@cl.example",
    department: "Sales",
    entity: "CL",
    manager: "3010",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1090",
  },
  {
    odooId: "3020",
    name: "Qais Al-Hosni",
    email: "qais.alhosni@cl.example",
    department: "Support",
    entity: "CL",
    manager: "1003",
    roleTrack: "LEAD",
    basicSalary: "1800",
  },
  {
    odooId: "3021",
    name: "Iman Al-Rahbi",
    email: "iman.alrahbi@cl.example",
    department: "Support",
    entity: "CL",
    manager: "3020",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1040",
  },
  {
    odooId: "3022",
    name: "Adil Al-Mahrizi",
    email: "adil.almahrizi@cl.example",
    department: "Support",
    entity: "CL",
    manager: "3020",
    roleTrack: "INDIVIDUAL",
    basicSalary: "1050",
  },
];

export async function seedPms(prisma: PrismaClient): Promise<void> {
  // --- Entities -------------------------------------------------------------
  const entityIds = new Map<string, string>();
  for (const entity of ENTITIES) {
    const found = await prisma.orgEntity.findUnique({
      where: { code: entity.code },
      select: { id: true },
    });
    if (found) {
      entityIds.set(entity.code, found.id);
      continue;
    }
    const row = await prisma.orgEntity.create({ data: entity, select: { id: true } });
    entityIds.set(entity.code, row.id);
  }

  // --- Departments ----------------------------------------------------------
  const departmentIds = new Map<string, string>(); // `${entityCode}::${name}`
  for (const dept of DEPARTMENTS) {
    const entityId = entityIds.get(dept.entity);
    if (!entityId) continue;
    const key = `${dept.entity}::${dept.name}`;

    const found = await prisma.department.findUnique({
      where: { entityId_name: { entityId, name: dept.name } },
      select: { id: true },
    });
    if (found) {
      departmentIds.set(key, found.id);
      continue;
    }
    const row = await prisma.department.create({
      data: { name: dept.name, entityId },
      select: { id: true },
    });
    departmentIds.set(key, row.id);
  }

  // --- Employees, without manager edges -------------------------------------
  // Same two-pass shape as the import applier and for the same reason: a
  // manager may be created after their report, and the self-referencing FK is
  // enforced per statement.
  const employeeIds = new Map<string, string>();
  for (const employee of EMPLOYEES) {
    const entityId = entityIds.get(employee.entity);
    if (!entityId) continue;

    const departmentId = employee.department
      ? (departmentIds.get(`${employee.entity}::${employee.department}`) ?? null)
      : null;

    const found = await prisma.employee.findUnique({
      where: { odooId: employee.odooId },
      select: { id: true },
    });
    if (found) {
      employeeIds.set(employee.odooId, found.id);
      continue;
    }

    const row = await prisma.employee.create({
      data: {
        odooId: employee.odooId,
        name: employee.name,
        email: employee.email,
        departmentId,
        entityId,
        roleTrack: employee.roleTrack,
        // ADR-067 — even the fixture is encrypted, so a dev database never
        // holds a shape production does not.
        basicSalaryEnc: encryptSalary(employee.basicSalary, employee.odooId),
        // §3.3 — the anchor for §11's eligibility gate and pro-ration. Most of
        // the fixture is long-tenured; a couple of rows carry an offset that
        // puts them under §11.2's six-month gate, so the gate has something to
        // actually decide rather than passing everyone trivially.
        dateOfJoining: joiningDate(employee.joinedMonthsAgo),
        unpaidLeaveDays: employee.unpaidLeaveDays ?? 0,
      },
      select: { id: true },
    });
    employeeIds.set(employee.odooId, row.id);
  }

  // --- Manager edges --------------------------------------------------------
  for (const employee of EMPLOYEES) {
    if (!employee.manager) continue;
    const id = employeeIds.get(employee.odooId);
    const managerId = employeeIds.get(employee.manager);
    if (!id || !managerId) continue;

    const current = await prisma.employee.findUnique({
      where: { id },
      select: { managerId: true },
    });
    // Skip a no-op write so re-seeding does not churn updatedAt.
    if (current?.managerId === managerId) continue;

    await prisma.employee.update({ where: { id }, data: { managerId } });
  }

  await bootstrapAdminEmployee(prisma, entityIds, departmentIds);

  const provisioned = await provisionFixtureLogins(prisma, employeeIds);

  console.log(
    `PMS fixture: ${ENTITIES.length} entities, ${DEPARTMENTS.length} departments, ` +
      `${EMPLOYEES.length} employees, ${provisioned} login(s) provisioned.`,
  );
}

/**
 * Give every fixture employee the same login the IMPORT would have given them —
 * ADR-069.
 *
 * The rule is a property of an employee record existing, not of the route that
 * created it. Applying an import provisions a linked, passwordless `VIEWER`; a
 * seeded fixture that did not would produce a database whose people are
 * unreachable in a way no imported population ever is, and the demo would be the
 * place that got discovered.
 *
 * Passwordless, exactly as the import's is: `authorize()` returns null without a
 * hash, so these accounts cannot be signed into with a guessed password. They
 * become usable when an IdP is configured (`AUTH_ENTRA_*`) or when a platform
 * admin sets a password for a named person at `/users`. Seeding thirty-seven
 * shared passwords to make a demo convenient is the one thing this must not do.
 */
async function provisionFixtureLogins(
  prisma: PrismaClient,
  employeeIds: Map<string, string>,
): Promise<number> {
  let provisioned = 0;
  for (const employee of EMPLOYEES) {
    const id = employeeIds.get(employee.odooId);
    if (!id) continue;

    const current = await prisma.employee.findUnique({
      where: { id },
      select: { userId: true, status: true },
    });
    if (current?.userId) continue;
    // §12.1 — a leaver's record is preserved; their access is not created. The
    // fixture defines no leavers today, so the status is read from the ROW
    // rather than the literal: a leaver added later, or one off-boarded in a
    // long-lived dev database, must not be handed an account by a re-seed.
    if (current?.status === "LEAVER") continue;

    const email = employee.email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    // An account made by hand keeps its role and its password; re-seeding must
    // disturb nobody, for the same reason a re-import must not (§3.5).
    if (existing) {
      await prisma.employee.update({ where: { id }, data: { userId: existing.id } });
      continue;
    }

    const user = await prisma.user.create({
      data: { email, name: employee.name, role: "VIEWER" },
      select: { id: true },
    });
    await prisma.employee.update({ where: { id }, data: { userId: user.id } });
    provisioned++;
  }
  return provisioned;
}

/**
 * First-run bootstrap: give the deploy's seeded admin a way INTO the PMS.
 *
 * ADR-065 keeps platform authority (`User.role`) and HR authority
 * (role assignments) deliberately separate, and `resolveActor` is right to
 * resolve a `User` with no `Employee` to an actor who sees nothing. The
 * consequence on a fresh deploy is that the operator logs into their own new
 * instance and the PMS is empty with no way in — the fixture's HR Super Admin
 * (Fatma Al-Rashdi) is an `Employee` row, and employees have no password.
 *
 * So this creates ONE employee record for `SEED_ADMIN_EMAIL` carrying
 * HR_SUPER_ADMIN, which is a bootstrap, not a rule change: nothing in
 * `lib/pms/permissions.ts` learns to trust `User.role`.
 *
 * Three guards keep it out of a real deployment:
 *
 *  1. It never runs without `SEED_ADMIN_EMAIL` — the same variable /deploy sets
 *     when it provisions the admin login.
 *  2. It never MUTATES an employee. If a record already exists for that email —
 *     because HR imported the operator as a real person — it returns untouched,
 *     so an import can never be overridden into HR Super Admin by a redeploy.
 *  3. It only runs while the demo fixture is the ENTIRE population. The moment
 *     HR imports the real org the headcount stops matching and this goes
 *     permanently silent, which is the point: a prototype needs a door, a system
 *     holding real appraisals must not grant HR authority from a build step.
 *
 * Phase 2 owes an explicit HR-role administration screen; this seam disappears
 * then. Tracked in docs/blueprints/performance-management-system.md.
 */
async function bootstrapAdminEmployee(
  prisma: PrismaClient,
  entityIds: Map<string, string>,
  departmentIds: Map<string, string>,
): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase().trim();
  if (!email) return;

  // Guard 2 — never mutate. An existing record wins, whatever its roles.
  const existing = await prisma.employee.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) return;

  // Guard 3 — the fixture must be the whole population.
  const headcount = await prisma.employee.count();
  if (headcount !== EMPLOYEES.length) {
    console.log(
      `PMS bootstrap: skipped for ${email} — headcount is ${headcount}, not the ` +
        `${EMPLOYEES.length}-person demo fixture, so this database holds real org data. ` +
        `Grant HR roles deliberately instead of from a build step.`,
    );
    return;
  }

  const entityId = entityIds.get("RIHAL");
  const departmentId = departmentIds.get("RIHAL::HR");
  if (!entityId || !departmentId) return;

  // The login may not exist: prisma/seed.ts skips the admin seed in production
  // when SEED_ADMIN_PASSWORD is unset. Linking is then left to resolveActor's
  // first-login email path, which only ever links a record with userId: null.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true },
  });

  await prisma.employee.create({
    data: {
      // Namespaced so it cannot collide with a real Odoo id (§3.2 keys on this).
      odooId: "BOOTSTRAP-ADMIN",
      name: user?.name ?? "HR Super Admin",
      email,
      departmentId,
      entityId,
      roleTrack: "MANAGER",
      // No salary invented: this is an access record, not a person's pay data.
      // Nor a joining date — §11 refuses to compute a bonus without one, which
      // is the right outcome for a bootstrap record that is not a real hire.
      unpaidLeaveDays: 0,
      userId: user?.id ?? null,
    },
    select: { id: true },
  });

  // HR authority is a role assignment (F-c): the starter HR Super Admin role at
  // Group scope, when the login exists. Find-then-create keeps it audited.
  const role = await prisma.accessRole.findFirst({
    where: { starterKey: "HR_SUPER_ADMIN", deletedAt: null },
    select: { id: true },
  });
  if (user && role) {
    const held = await prisma.roleAssignment.findFirst({
      where: { userId: user.id, roleId: role.id, scopeType: "GROUP" },
      select: { id: true },
    });
    if (!held) {
      await prisma.roleAssignment.create({
        data: { userId: user.id, roleId: role.id, scopeType: "GROUP", note: "Bootstrap admin" },
        select: { id: true },
      });
    }
  }

  console.log(`PMS bootstrap: ${email} seeded as HR Super Admin (odooId BOOTSTRAP-ADMIN).`);
}
