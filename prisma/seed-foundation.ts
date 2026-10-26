import type { PrismaClient } from "../generated/prisma/client";

/**
 * HR Centre's production seed — the foundation a fresh database starts from.
 *
 * HR Centre began as a copy of the Performance app (2026-10-26) on a NEW, empty
 * database. Its demo fixture (`seed-pms.ts`, 36 invented employees) used to run
 * on every deploy; it now runs only when `SEED_DEMO=1` is set (local dev), so a
 * real deployment holds nothing HR did not put there.
 *
 * What a fresh database gets, and nothing more:
 *  - the three companies, keyed by the import codes the Excel loader already
 *    uses (RIHAL / TP / CL) with their full names — HR may rename them, and the
 *    codes are pending HR's confirmation;
 *  - an "HR" department under Rihal, so the bootstrap admin has somewhere to sit
 *    (spec §1.2: HR exists only in Rihal). Every other department arrives
 *    through HR's import;
 *  - the bootstrap HR Super Admin record for `SEED_ADMIN_EMAIL` (below).
 *
 * Idempotent — `vercel.json` runs the seed on every build. Uses the RAW client,
 * so plain creates; findUnique-then-create rather than `upsert`, which would
 * trip no-unaudited-bulk-write.
 */

const COMPANIES = [
  { code: "RIHAL", name: "Rihal" },
  { code: "TP", name: "Transformation Pioneers" },
  { code: "CL", name: "Codeline" },
];

const BOOTSTRAP_DEPARTMENT = { entity: "RIHAL", name: "HR" };

export async function seedFoundation(prisma: PrismaClient): Promise<void> {
  const entityIds = new Map<string, string>();
  for (const company of COMPANIES) {
    const found = await prisma.orgEntity.findUnique({
      where: { code: company.code },
      select: { id: true },
    });
    const id =
      found?.id ?? (await prisma.orgEntity.create({ data: company, select: { id: true } })).id;
    entityIds.set(company.code, id);
  }

  const entityId = entityIds.get(BOOTSTRAP_DEPARTMENT.entity)!;
  const foundDept = await prisma.department.findUnique({
    where: { entityId_name: { entityId, name: BOOTSTRAP_DEPARTMENT.name } },
    select: { id: true },
  });
  const departmentId =
    foundDept?.id ??
    (
      await prisma.department.create({
        data: { entityId, name: BOOTSTRAP_DEPARTMENT.name },
        select: { id: true },
      })
    ).id;

  await bootstrapAdminEmployee(prisma, entityId, departmentId);
}

/**
 * First-run door into HR Centre: one Employee record for `SEED_ADMIN_EMAIL`
 * carrying HR_SUPER_ADMIN, so the operator can reach Admin → Roles and grant HR
 * authority to real people. Platform authority (`User.role`) and HR authority
 * (`Employee.pmsRoles`) stay separate (ADR-065); this does not change that.
 *
 * Same guards as the demo-era bootstrap it replaces, with guard 3 retargeted at
 * an empty database instead of the demo fixture:
 *  1. Never runs without `SEED_ADMIN_EMAIL`.
 *  2. Never mutates: an existing record for that email wins, whatever its roles.
 *  3. Only runs while the database holds NO employees. Once HR imports anyone,
 *     it goes permanently silent — a system holding real appraisals must not
 *     grant HR authority from a build step.
 */
async function bootstrapAdminEmployee(
  prisma: PrismaClient,
  entityId: string,
  departmentId: string,
): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase().trim();
  if (!email) return;

  const existing = await prisma.employee.findUnique({ where: { email }, select: { id: true } });
  if (existing) return;

  const headcount = await prisma.employee.count();
  if (headcount !== 0) {
    console.log(
      `HR Centre bootstrap: skipped for ${email} — ${headcount} employee(s) already exist. ` +
        `Grant HR roles in Admin → Roles instead of from a build step.`,
    );
    return;
  }

  // The login may not exist yet (seed.ts skips the admin in production while
  // SEED_ADMIN_PASSWORD is unset); resolveActor links it on first login by email.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true },
  });

  await prisma.employee.create({
    data: {
      // Namespaced so it cannot collide with a real Odoo id.
      odooId: "BOOTSTRAP-ADMIN",
      name: user?.name ?? "HR Super Admin",
      email,
      departmentId,
      entityId,
      roleTrack: "MANAGER",
      pmsRoles: ["HR_SUPER_ADMIN"],
      // An access record, not a person: no salary, no joining date.
      unpaidLeaveDays: 0,
      userId: user?.id ?? null,
    },
    select: { id: true },
  });

  console.log(`HR Centre bootstrap: ${email} seeded as HR Super Admin (odooId BOOTSTRAP-ADMIN).`);
}
