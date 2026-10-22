import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { prisma } from "../lib/prisma";

/**
 * The EXTENDED client's type, not the bare `PrismaClient`.
 *
 * Deliberate: the extensions are what make the removals soft and audited, so a
 * signature that accepted a raw client would let a caller silently reintroduce
 * hard deletes — which is exactly the bug the first version of this tool had.
 */
type Db = typeof prisma;
import { hashPassword } from "../lib/password";

/**
 * Wipe the test dataset and rebuild a small realistic one. `npm run db:dummy-data`.
 *
 * ## Why this exists
 *
 * An import of test employees left a deployment unusable: the fake people are
 * enrolled participants who can never be scored, so §10.7's gate blocks
 * calibration, publish and the 360 permanently. Marking them LEAVER does
 * nothing — that revokes a login and touches no participant row.
 *
 * ## What is reversible and what is not
 *
 * People, departments and entities are SOFT deleted, so the Recycling Bin can
 * put them back. That also sidesteps every FK `RESTRICT` hanging off
 * `employees` (cycle_participants, kpi_ratings, sign_offs, score_runs and six
 * more), because a soft delete is an UPDATE.
 *
 * Cycles are HARD deleted and that is irreversible. `PerformanceCycle` carries
 * `deletedAt` columns but is not in `SOFT_DELETE_MODELS` and no reader filters
 * on them, so setting it would be a no-op that merely looked reversible — the
 * cycle would still appear in every picker and still count toward the gates.
 * Everything attached cascades: participants, KPIs, ratings, evidence,
 * signatures, change requests, score runs, employee scores, calibration
 * adjustments, the 360 cycle with its templates, assignments and responses,
 * publications, Strategy scores and assignment periods.
 *
 * Logins and the audit log are untouched, and cannot be taken by this:
 * `users → employees` and `users → audit_logs` are both `SET NULL`, and
 * `audit_logs` has no foreign key to `employees` at all.
 *
 * ## Dry run is the default
 *
 * With no flags this writes nothing and prints the plan. See
 * `docs/runbooks/reset-dummy-data.md`.
 */

// --- the guard --------------------------------------------------------------

/** The exact value the env var must carry. Not a boolean: a typo must not pass. */
const SENTINEL = "yes-wipe-and-reseed";

/**
 * Reserved identifier namespaces.
 *
 * Load-bearing, because unique indexes IGNORE `deletedAt`: a soft-deleted
 * employee keeps its `odoo_id` and `email`, a soft-deleted entity keeps its
 * `code`, and a soft-deleted department keeps its `(entityId, name)`. So the
 * re-seed cannot simply create the same rows again. Everything this tool
 * creates lives inside these prefixes, and a re-run HARD deletes the previous
 * generation of them first — which is safe precisely because they are this
 * tool's own rows and never anybody's real record.
 */
const NS = { odoo: "DUMMY-", email: "@dummy.rihal.test", entity: "DEMO-" } as const;

export type Mode = "dry-run" | "apply";

export interface ResetOptions {
  mode: Mode;
  /** Must equal the number of employees to be removed, re-derived at apply time. */
  confirm?: number;
  /** The performance year to create. */
  year: number;
}

/**
 * Why this run may not proceed, or null.
 *
 * Five parts, operator-approved. No property of the DATA can tell a test
 * deployment from a live one — both have import batches and hundreds of
 * employees — so the guard is an explicit declaration plus the one honest data
 * signal there is.
 */
export async function guardBlockedReason(
  prisma: Db,
  opts: ResetOptions,
  removalCount: number,
): Promise<string | null> {
  // 1. A committed, reviewable flag. `/handoff` flips this to false at go-live.
  let allowed = false;
  try {
    const cfg = JSON.parse(readFileSync("project.config.json", "utf8")) as {
      dummyData?: { resetAllowed?: boolean };
    };
    allowed = cfg.dummyData?.resetAllowed === true;
  } catch {
    allowed = false;
  }
  if (!allowed) {
    return (
      'project.config.json does not set "dummyData": { "resetAllowed": true }. ' +
      "This is the flag that goes false at go-live, and it is deliberately in git " +
      "so turning it back on is a reviewable commit rather than a shell variable."
    );
  }

  // 2. An exact sentinel, so a stray truthy value cannot arm this.
  if (process.env.DUMMY_DATA_RESET !== SENTINEL) {
    return `DUMMY_DATA_RESET must be set to exactly "${SENTINEL}".`;
  }

  // 3. The one data signal worth trusting: released results mean real people
  //    have already seen them, so this is a live deployment whatever the flags
  //    say. Checked before anything is read in detail, and before any write.
  const published = await prisma.cyclePublication.findFirst({
    where: { published: true },
    select: { cycle: { select: { year: true } } },
  });
  if (published) {
    return (
      `cycle ${published.cycle.year} has PUBLISHED results. Real people have seen them, so ` +
      "this refuses regardless of the flags above. If that publication was itself a test, " +
      "un-publish it in the app first — deliberately, by hand."
    );
  }

  // 4/5. Only for a real run: the typed count, re-derived now rather than
  //      trusted from the dry run, so a dataset that changed in between stops.
  if (opts.mode === "apply") {
    if (opts.confirm === undefined) {
      return `--apply needs --confirm ${removalCount} (the number of employees to be removed).`;
    }
    if (opts.confirm !== removalCount) {
      return (
        `--confirm ${opts.confirm} does not match the ${removalCount} employees this would ` +
        "remove. The dataset has changed since the preview — re-run the dry run and read it again."
      );
    }
  }
  return null;
}

// --- the plan ---------------------------------------------------------------

interface EmployeePlan {
  id: string;
  name: string;
  roleTrack: string;
  keep: boolean;
  reason: string;
}

/**
 * Who stays and who goes. Operator-confirmed rule, in priority order so the
 * printed reason is the most reassuring true one.
 */
function keepReason(e: {
  name: string;
  pmsRoles: string[];
  user: { role: string; passwordHash: string | null } | null;
}): string | null {
  const NAMED = ["muna adam", "tariq al-naaimi", "tariq al naaimi"];
  if (e.user?.role === "ADMIN") return "platform ADMIN";
  if (e.pmsRoles.includes("HR_SUPER_ADMIN")) return "HR Super Admin";
  if (e.pmsRoles.includes("HRBP")) return "HRBP";
  if (e.user?.passwordHash) return "can sign in today";
  if (NAMED.includes(e.name.trim().toLowerCase())) return "named by the operator";
  return null;
}

export interface CyclePlan {
  id: string;
  year: number;
  status: string;
  counts: Record<string, number>;
}

export interface Plan {
  employees: EmployeePlan[];
  departments: { id: string; name: string }[];
  entities: { id: string; name: string; code: string }[];
  cycles: CyclePlan[];
  previousDummies: number;
}

export async function buildPlan(prisma: Db): Promise<Plan> {
  const employees = await prisma.employee.findMany({
    take: 5000,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      odooId: true,
      roleTrack: true,
      pmsRoles: true,
      user: { select: { role: true, passwordHash: true } },
    },
  });

  const plan: EmployeePlan[] = employees.map((e) => {
    const reason = keepReason(e);
    return {
      id: e.id,
      name: e.name,
      roleTrack: e.roleTrack,
      keep: reason !== null,
      reason: reason ?? "test data",
    };
  });

  const [departments, entities, cycles] = await Promise.all([
    prisma.department.findMany({
      take: 500,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.orgEntity.findMany({
      take: 100,
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    prisma.performanceCycle.findMany({
      take: 100,
      orderBy: { year: "asc" },
      select: { id: true, year: true, status: true },
    }),
  ]);

  // What each cycle takes with it. Counted per cycle because that is the number
  // the operator has to approve, and a total would hide which year holds what.
  const withCounts: CyclePlan[] = [];
  for (const c of cycles) {
    const [
      participants,
      kpis,
      ratings,
      signOffs,
      evidence,
      scores,
      tsc,
      assignments,
      responses,
      entityScores,
      deptScores,
      publications,
    ] = await Promise.all([
      prisma.cycleParticipant.count({ where: { cycleId: c.id } }),
      prisma.kpi.count({ where: { participant: { cycleId: c.id } } }),
      prisma.kpiRating.count({ where: { kpi: { participant: { cycleId: c.id } } } }),
      prisma.signOff.count({ where: { participant: { cycleId: c.id } } }),
      prisma.kpiEvidence.count({ where: { kpi: { participant: { cycleId: c.id } } } }),
      prisma.employeeScore.count({ where: { scoreRun: { cycleId: c.id } } }),
      prisma.threeSixtyCycle.count({ where: { cycleId: c.id } }),
      prisma.assignment.count({ where: { threeSixtyCycle: { cycleId: c.id } } }),
      prisma.assignmentResponse.count({
        where: { assignment: { threeSixtyCycle: { cycleId: c.id } } },
      }),
      prisma.entityScore.count({ where: { cycleId: c.id } }),
      prisma.departmentScore.count({ where: { cycleId: c.id } }),
      prisma.cyclePublication.count({ where: { cycleId: c.id } }),
    ]);
    withCounts.push({
      id: c.id,
      year: c.year,
      status: c.status,
      counts: {
        participants,
        KPIs: kpis,
        ratings,
        signatures: signOffs,
        "evidence items": evidence,
        "employee scores": scores,
        "360 cycles": tsc,
        "360 assignments": assignments,
        "360 responses": responses,
        "corporate scores": entityScores,
        "departmental scores": deptScores,
        "publication records": publications,
      },
    });
  }

  const previousDummies = employees.filter((e) => e.odooId?.startsWith(NS.odoo)).length;
  return { employees: plan, departments, entities, cycles: withCounts, previousDummies };
}

// --- the printed preview ----------------------------------------------------

/** Plain language, because the person approving this is not a developer. */
export function printPlan(plan: Plan, opts: ResetOptions): void {
  const out = (s = "") => console.log(s);
  const keep = plan.employees.filter((e) => e.keep);
  const go = plan.employees.filter((e) => !e.keep);

  out();
  out("==========================================================");
  out(
    opts.mode === "dry-run"
      ? "  DRY RUN — nothing will be changed"
      : "  APPLYING — this will change data",
  );
  out("==========================================================");
  out();

  out(`PEOPLE WHO STAY (${keep.length})`);
  out("  These keep their records and their logins.");
  out();
  for (const e of keep) out(`    KEEP   ${e.name}  —  ${e.reason}`);
  if (keep.length === 0) out("    (none — see the warning below)");
  out();

  out(`PEOPLE WHO GO (${go.length})`);
  out("  Moved to the Recycling Bin. Reversible: an HR admin can restore any of");
  out("  them from Recycling Bin in the app. Their logins are NOT deleted.");
  out();
  for (const e of go) out(`    REMOVE ${e.name}  (${e.roleTrack})`);
  if (go.length === 0) out("    (none)");
  out();

  out(`DEPARTMENTS WHO GO (${plan.departments.length})  — also reversible`);
  for (const d of plan.departments) out(`    REMOVE ${d.name}`);
  out();
  out(`ENTITIES WHO GO (${plan.entities.length})  — also reversible`);
  for (const e of plan.entities) out(`    REMOVE ${e.name} (${e.code})`);
  out();

  out("==========================================================");
  out(`CYCLES REMOVED PERMANENTLY (${plan.cycles.length})`);
  out("  THIS CANNOT BE UNDONE. Cycles do not go to the Recycling Bin.");
  out("==========================================================");
  for (const c of plan.cycles) {
    out();
    out(`    Cycle ${c.year}  (${c.status})  — deleting it also deletes:`);
    for (const [label, n] of Object.entries(c.counts)) {
      if (n > 0) out(`        ${String(n).padStart(6)}  ${label}`);
    }
    if (Object.values(c.counts).every((n) => n === 0)) out("        (nothing attached)");
  }
  if (plan.cycles.length === 0) out("    (no cycles exist)");
  out();

  out("THEN CREATED");
  out("    2 entities, 3 departments, 24 people with full reporting lines");
  out(`    1 fresh performance cycle for ${opts.year}, all three stages open`);
  out("    5 logins with passwords (one per role track), printed once at the end");
  if (plan.previousDummies > 0) {
    out();
    out(`    NOTE: ${plan.previousDummies} people from a previous run of this tool will be`);
    out("    permanently removed first, so the new dataset is clean. They are this");
    out("    tool's own rows, never real records.");
  }
  out();
}

// --- the dataset ------------------------------------------------------------

type Track = "C_LEVEL" | "DIRECTOR" | "MANAGER" | "LEAD" | "INDIVIDUAL";

interface Person {
  n: number;
  name: string;
  track: Track;
  entity: "A" | "B";
  dept: "ENG" | "DEL" | "OPS" | null;
  managerN: number | null;
  salary: number;
  edge?: "newJoiner" | "unpaidLeave" | "transfer" | "leaver";
}

/**
 * 24 people. Every department is ≥5 so §10.4's curve threshold can be
 * exercised in each; the smallest is 6, so everyone has their manager plus at
 * least two same-department peers available as 360 raters.
 */
const PEOPLE: Person[] = [
  {
    n: 1,
    name: "Khalid Al-Lawati",
    track: "C_LEVEL",
    entity: "A",
    dept: null,
    managerN: null,
    salary: 4200,
  },
  {
    n: 2,
    name: "Noora Al-Zadjali",
    track: "C_LEVEL",
    entity: "B",
    dept: null,
    managerN: null,
    salary: 4000,
  },

  // Rihal (demo) — Engineering, 9
  {
    n: 3,
    name: "Yousuf Al-Harthy",
    track: "DIRECTOR",
    entity: "A",
    dept: "ENG",
    managerN: 1,
    salary: 3100,
  },
  {
    n: 4,
    name: "Salma Al-Balushi",
    track: "MANAGER",
    entity: "A",
    dept: "ENG",
    managerN: 3,
    salary: 2400,
  },
  {
    n: 5,
    name: "Hamed Al-Rawahi",
    track: "LEAD",
    entity: "A",
    dept: "ENG",
    managerN: 4,
    salary: 1900,
  },
  {
    n: 6,
    name: "Layla Al-Siyabi",
    track: "INDIVIDUAL",
    entity: "A",
    dept: "ENG",
    managerN: 5,
    salary: 1450,
  },
  {
    n: 7,
    name: "Majid Al-Habsi",
    track: "INDIVIDUAL",
    entity: "A",
    dept: "ENG",
    managerN: 5,
    salary: 1380,
  },
  {
    n: 8,
    name: "Rawan Al-Kindi",
    track: "INDIVIDUAL",
    entity: "A",
    dept: "ENG",
    managerN: 5,
    salary: 1500,
  },
  {
    n: 9,
    name: "Saif Al-Mamari",
    track: "INDIVIDUAL",
    entity: "A",
    dept: "ENG",
    managerN: 4,
    salary: 1620,
  },
  {
    n: 10,
    name: "Dana Al-Jabri",
    track: "INDIVIDUAL",
    entity: "A",
    dept: "ENG",
    managerN: 4,
    salary: 1310,
    edge: "newJoiner",
  },
  {
    n: 11,
    name: "Talib Al-Amri",
    track: "INDIVIDUAL",
    entity: "A",
    dept: "ENG",
    managerN: 5,
    salary: 1270,
    edge: "unpaidLeave",
  },

  // Rihal (demo) — Delivery, 6
  {
    n: 12,
    name: "Iman Al-Saadi",
    track: "MANAGER",
    entity: "A",
    dept: "DEL",
    managerN: 3,
    salary: 2350,
  },
  {
    n: 13,
    name: "Badr Al-Shukaili",
    track: "LEAD",
    entity: "A",
    dept: "DEL",
    managerN: 12,
    salary: 1850,
  },
  {
    n: 14,
    name: "Hind Al-Battashi",
    track: "INDIVIDUAL",
    entity: "A",
    dept: "DEL",
    managerN: 13,
    salary: 1420,
  },
  {
    n: 15,
    name: "Qais Al-Maskari",
    track: "INDIVIDUAL",
    entity: "A",
    dept: "DEL",
    managerN: 13,
    salary: 1360,
  },
  {
    n: 16,
    name: "Shatha Al-Riyami",
    track: "INDIVIDUAL",
    entity: "A",
    dept: "DEL",
    managerN: 12,
    salary: 1540,
  },
  {
    n: 17,
    name: "Fahad Al-Ghafri",
    track: "INDIVIDUAL",
    entity: "A",
    dept: "DEL",
    managerN: 13,
    salary: 1290,
    edge: "transfer",
  },

  // TP (demo) — Operations, 7
  {
    n: 18,
    name: "Amal Al-Hinai",
    track: "DIRECTOR",
    entity: "B",
    dept: "OPS",
    managerN: 2,
    salary: 3000,
  },
  {
    n: 19,
    name: "Sultan Al-Azri",
    track: "MANAGER",
    entity: "B",
    dept: "OPS",
    managerN: 18,
    salary: 2300,
  },
  {
    n: 20,
    name: "Muzna Al-Nabhani",
    track: "LEAD",
    entity: "B",
    dept: "OPS",
    managerN: 19,
    salary: 1800,
  },
  {
    n: 21,
    name: "Nasser Al-Qasmi",
    track: "INDIVIDUAL",
    entity: "B",
    dept: "OPS",
    managerN: 20,
    salary: 1400,
  },
  {
    n: 22,
    name: "Buthaina Al-Wahaibi",
    track: "INDIVIDUAL",
    entity: "B",
    dept: "OPS",
    managerN: 20,
    salary: 1330,
  },
  {
    n: 23,
    name: "Ammar Al-Farsi",
    track: "INDIVIDUAL",
    entity: "B",
    dept: "OPS",
    managerN: 19,
    salary: 1480,
  },
  {
    n: 24,
    name: "Zayana Al-Mahrouqi",
    track: "INDIVIDUAL",
    entity: "B",
    dept: "OPS",
    managerN: 20,
    salary: 1240,
    edge: "leaver",
  },
];

const pad = (n: number) => String(n).padStart(3, "0");
const odooFor = (n: number) => `${NS.odoo}${pad(n)}`;
const emailFor = (p: Person) =>
  `${p.name
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "")}${NS.email}`;

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** One account per role track gets a generated password; the rest stay passwordless. */
const PASSWORD_TRACKS: Track[] = ["C_LEVEL", "DIRECTOR", "MANAGER", "LEAD", "INDIVIDUAL"];

function newPassword(): string {
  // 18 URL-safe characters. Generated per run, printed once, never stored
  // anywhere but the hash — `seed-pms.ts` is explicit that a committed shared
  // password is the one thing a fixture must not create.
  return randomBytes(14).toString("base64url");
}
export { newPassword, PEOPLE, NS, SENTINEL, PASSWORD_TRACKS, odooFor, emailFor, utc };

// --- the write half ---------------------------------------------------------

export interface Login {
  role: Track;
  name: string;
  email: string;
  password: string;
}

const DEPTS = {
  ENG: { entity: "A" as const, name: "Engineering" },
  DEL: { entity: "A" as const, name: "Delivery" },
  OPS: { entity: "B" as const, name: "Operations" },
};

/**
 * Do it. Order is forced by the foreign keys, not by preference:
 *
 *  1. Cycles first. Every `RESTRICT` that would block a hard delete of an
 *     employee (cycle_participants, kpi_ratings, sign_offs, score_runs and six
 *     more) hangs off a cycle, so clearing cycles clears all of them at once.
 *  2. The previous generation of THIS tool's own rows, hard, so the reserved
 *     namespace is free again — unique indexes ignore `deletedAt`, so a
 *     soft-deleted `DUMMY-001` would otherwise block the new one.
 *  3. Everything else people-shaped, SOFT, so the Recycling Bin can undo it.
 *  4. Re-seed.
 */
export async function applyReset(
  prisma: Db,
  plan: Plan,
  opts: ResetOptions,
): Promise<{ logins: Login[]; removedEmployees: number }> {
  const say = (s: string) => console.log(`  ${s}`);

  // 1 — cycles, permanently.
  for (const c of plan.cycles) {
    await prisma.performanceCycle.delete({ where: { id: c.id } });
    say(`removed cycle ${c.year} and everything attached to it`);
  }

  // 2 — the previous dummy generation, permanently. Scoped to the reserved
  //     prefixes, which only this tool ever writes. Parameterised, and every
  //     statement carries a WHERE (CLAUDE.md's raw-SQL rule).
  const odooLike = `${NS.odoo}%`;
  const emailLike = `%${NS.email}`;
  const entityLike = `${NS.entity}%`;
  await prisma.$executeRaw`DELETE FROM employees WHERE odoo_id LIKE ${odooLike}`;
  await prisma.$executeRaw`DELETE FROM users WHERE email LIKE ${emailLike}`;
  await prisma.$executeRaw`DELETE FROM departments WHERE "entityId" IN (SELECT id FROM org_entities WHERE code LIKE ${entityLike})`;
  await prisma.$executeRaw`DELETE FROM org_entities WHERE code LIKE ${entityLike}`;
  if (plan.previousDummies > 0) say(`cleared ${plan.previousDummies} rows from a previous run`);

  // 3 — the real test data, reversibly. `prisma.employee.delete()` is rewritten
  //     into a `deletedAt` update by the soft-delete extension, and the audit
  //     extension records who did it.
  let removedEmployees = 0;
  for (const e of plan.employees.filter((p) => !p.keep)) {
    // A previous-generation dummy is already gone from step 2.
    const still = await prisma.employee.findUnique({ where: { id: e.id }, select: { id: true } });
    if (!still) continue;
    await prisma.employee.delete({ where: { id: e.id } });
    removedEmployees += 1;
  }
  say(`moved ${removedEmployees} people to the Recycling Bin`);

  for (const d of plan.departments) {
    const still = await prisma.department.findUnique({ where: { id: d.id }, select: { id: true } });
    if (still) await prisma.department.delete({ where: { id: d.id } });
  }
  for (const en of plan.entities) {
    const still = await prisma.orgEntity.findUnique({ where: { id: en.id }, select: { id: true } });
    if (still) await prisma.orgEntity.delete({ where: { id: en.id } });
  }
  say(
    `moved ${plan.departments.length} departments and ${plan.entities.length} entities to the bin`,
  );

  // 4 — the new dataset.
  const entityA = await prisma.orgEntity.create({
    data: { code: `${NS.entity}RIHAL`, name: "Rihal (demo)" },
    select: { id: true },
  });
  const entityB = await prisma.orgEntity.create({
    data: { code: `${NS.entity}TP`, name: "TP (demo)" },
    select: { id: true },
  });
  const entityId = { A: entityA.id, B: entityB.id };

  const deptId: Record<string, string> = {};
  for (const [key, d] of Object.entries(DEPTS)) {
    const row = await prisma.department.create({
      data: { name: d.name, entityId: entityId[d.entity] },
      select: { id: true },
    });
    deptId[key] = row.id;
  }
  say(`created 2 entities and ${Object.keys(DEPTS).length} departments`);

  // Pass one: the people, without managers — a manager has to exist first.
  const { encryptSalary } = await import("../lib/pms/employee-select");
  const today = new Date();
  const idByN = new Map<number, string>();
  for (const p of PEOPLE) {
    const odooId = odooFor(p.n);
    const row = await prisma.employee.create({
      data: {
        odooId,
        name: p.name,
        email: emailFor(p),
        roleTrack: p.track,
        entityId: entityId[p.entity],
        departmentId: p.dept ? deptId[p.dept] : null,
        status: p.edge === "leaver" ? "LEAVER" : "ACTIVE",
        // §11.7's six-month gate wants a date it can measure; the new joiner
        // sits inside the window on purpose.
        dateOfJoining:
          p.edge === "newJoiner"
            ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1))
            : utc(opts.year - 4, 1 + (p.n % 11), 1 + (p.n % 27)),
        lastWorkingDay: p.edge === "leaver" ? utc(opts.year, 8, 31) : null,
        unpaidLeaveDays: p.edge === "unpaidLeave" ? 30 : 0,
        basicSalaryEnc: encryptSalary(String(p.salary), odooId),
      },
      select: { id: true },
    });
    idByN.set(p.n, row.id);
  }

  // Pass two: the reporting lines.
  for (const p of PEOPLE) {
    if (p.managerN === null) continue;
    await prisma.employee.update({
      where: { id: idByN.get(p.n)! },
      data: { managerId: idByN.get(p.managerN)! },
      select: { id: true },
    });
  }
  say(`created ${PEOPLE.length} people with reporting lines`);

  // §2 — the cycle. All three windows open at once, with deadlines well out, so
  // every stage can be walked immediately and in any order rather than waiting
  // for a window or hitting §5.4's lock.
  const hr = await prisma.employee.findFirst({
    where: { pmsRoles: { has: "HR_SUPER_ADMIN" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const day = 24 * 60 * 60 * 1000;
  const cycle = await prisma.performanceCycle.create({
    data: {
      year: opts.year,
      status: "OPEN",
      openedById: hr?.id ?? null,
      openedAt: new Date(today.getTime() - 30 * day),
      stages: {
        create: [
          {
            kind: "GOAL_SETTING",
            opensAt: new Date(today.getTime() - 30 * day),
            deadline: new Date(today.getTime() + 60 * day),
          },
          {
            kind: "MID_YEAR",
            opensAt: new Date(today.getTime() - 29 * day),
            deadline: new Date(today.getTime() + 90 * day),
          },
          {
            kind: "YEAR_END",
            opensAt: new Date(today.getTime() - 28 * day),
            deadline: new Date(today.getTime() + 120 * day),
          },
        ],
      },
    },
    select: { id: true },
  });
  say(`created cycle ${opts.year} with all three stages open`);

  // §12.3 — the transfer's two periods, so the split-year path has real data.
  const mover = PEOPLE.find((p) => p.edge === "transfer")!;
  const moverId = idByN.get(mover.n)!;
  await prisma.employeeAssignmentPeriod.create({
    data: {
      employeeId: moverId,
      cycleId: cycle.id,
      orderIndex: 0,
      entityId: entityId.A,
      departmentId: deptId.ENG,
      startsOn: utc(opts.year, 1, 1),
      endsOn: utc(opts.year, 5, 31),
    },
    select: { id: true },
  });
  await prisma.employeeAssignmentPeriod.create({
    data: {
      employeeId: moverId,
      cycleId: cycle.id,
      orderIndex: 1,
      entityId: entityId.A,
      departmentId: deptId.DEL,
      startsOn: utc(opts.year, 6, 1),
      endsOn: utc(opts.year, 12, 31),
    },
    select: { id: true },
  });
  say(`created the §12.3 mid-cycle transfer for ${mover.name}`);

  // Enrol everyone, the same call the import and the cycle-open path use.
  const { enrolParticipants } = await import("../lib/pms/cycle");
  const enrolled = await enrolParticipants(cycle.id);
  say(`enrolled ${typeof enrolled === "number" ? enrolled : PEOPLE.length} participants`);

  // One passworded login per role track; everyone else stays passwordless,
  // exactly as an imported population is.
  const logins: Login[] = [];
  for (const track of PASSWORD_TRACKS) {
    const p = PEOPLE.find((x) => x.track === track && x.edge !== "leaver")!;
    const password = newPassword();
    const user = await prisma.user.create({
      data: {
        email: emailFor(p),
        name: p.name,
        role: "VIEWER",
        passwordHash: await hashPassword(password),
        emailVerified: new Date(),
      },
      select: { id: true },
    });
    await prisma.employee.update({
      where: { id: idByN.get(p.n)! },
      data: { userId: user.id },
      select: { id: true },
    });
    logins.push({ role: track, name: p.name, email: emailFor(p), password });
  }
  say(`created ${logins.length} logins with passwords`);

  return { logins, removedEmployees };
}
