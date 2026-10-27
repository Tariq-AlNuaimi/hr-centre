import type { PrismaClient } from "../generated/prisma/client";
import { STARTER_ROLES } from "../lib/rbac/catalogue";

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

export async function seedFoundation(prisma: PrismaClient): Promise<string | null> {
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

  await seedStarterRoles(prisma);
  return bootstrapAdminEmployee(prisma, entityId, departmentId);
}

/**
 * HR Centre F-c — the three starter roles (lib/rbac/catalogue.ts), created only
 * if no role carries that starter key. "No role" includes a SOFT-DELETED one
 * (this client has no soft-delete filter): an admin who deleted a starter role
 * meant it, and the next deploy must not bring it back. Never overwrites an
 * existing role's permissions — admins may have edited them.
 */
async function seedStarterRoles(prisma: PrismaClient): Promise<void> {
  for (const role of STARTER_ROLES) {
    const found = await prisma.accessRole.findUnique({
      where: { starterKey: role.key },
      select: { id: true },
    });
    if (found) continue;
    await prisma.accessRole.create({
      data: {
        name: role.name,
        description: role.description,
        permissions: [...role.permissions],
        starterKey: role.key,
      },
      select: { id: true },
    });
  }
}

/**
 * First-run door into HR Centre: one Employee record for `SEED_ADMIN_EMAIL`
 * holding the HR Super Admin role for the whole group (an F-c assignment), so
 * the operator can reach Admin → Roles and grant HR authority to real people.
 * Platform authority (`User.role`) and HR authority (role assignments) stay
 * separate (ADR-065); this does not change that.
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
): Promise<string | null> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase().trim();
  if (!email) return null;

  const existing = await prisma.employee.findUnique({ where: { email }, select: { id: true } });
  if (existing) return null;

  const headcount = await prisma.employee.count();
  if (headcount !== 0) {
    console.log(
      `HR Centre bootstrap: skipped for ${email} — ${headcount} employee(s) already exist. ` +
        `Grant HR roles in Admin → Roles instead of from a build step.`,
    );
    return null;
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
      // An access record, not a person: no salary, no joining date.
      unpaidLeaveDays: 0,
      userId: user?.id ?? null,
    },
    select: { id: true },
  });

  // F-c — HR authority is an assignment, granted once with the bootstrap
  // record (never re-derived on later deploys).
  const superAdmin = await prisma.accessRole.findUnique({
    where: { starterKey: "HR_SUPER_ADMIN" },
    select: { id: true, deletedAt: true },
  });
  if (user && superAdmin && superAdmin.deletedAt === null) {
    await prisma.roleAssignment.create({
      data: {
        userId: user.id,
        roleId: superAdmin.id,
        scopeType: "GROUP",
        note: "Bootstrap administrator (seed)",
      },
      select: { id: true },
    });
  }

  console.log(`HR Centre bootstrap: ${email} seeded as HR Super Admin (odooId BOOTSTRAP-ADMIN).`);
  return user?.id ?? null;
}

/**
 * UX review P0 (AC-5.2) — on the FIRST run only (the caller passes the user id
 * `bootstrapAdminEmployee` returned, which it does once, while no employee
 * exists), give the bootstrap administrator every module's admin starter role
 * at Whole group. Runs after the module seeds, which create those roles.
 * Existing databases got the same grant once from migration
 * 20261027180000_ux_p0_bootstrap_admin_roles. Never re-grants on later deploys.
 */
const MODULE_ADMIN_STARTER_KEYS = [
  "HR_SUPER_ADMIN",
  "JML_HR_MANAGER",
  "HIRING_ADMIN",
  "TICKETS_ADMIN",
] as const;

export async function grantBootstrapModuleAdmins(
  prisma: PrismaClient,
  userId: string | null,
): Promise<void> {
  if (!userId) return;
  const roles = await prisma.accessRole.findMany({
    where: { starterKey: { in: [...MODULE_ADMIN_STARTER_KEYS] }, deletedAt: null },
    select: { id: true },
    take: MODULE_ADMIN_STARTER_KEYS.length,
  });
  for (const role of roles) {
    const found = await prisma.roleAssignment.findFirst({
      where: { userId, roleId: role.id, scopeType: "GROUP" },
      select: { id: true },
    });
    if (found) continue;
    await prisma.roleAssignment.create({
      data: {
        userId,
        roleId: role.id,
        scopeType: "GROUP",
        note: "Bootstrap administrator: every module's admin role (one-time grant)",
      },
      select: { id: true },
    });
  }
}
