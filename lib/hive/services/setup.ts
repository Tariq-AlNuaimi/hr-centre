import readXlsxFile from "read-excel-file/node";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { OrgRuleError } from "@/lib/org/rules";
import { firstSheetRows, parseProviderSheet } from "@/lib/hive/provider-import";
import { loadRotationConfig } from "@/lib/hive/tools/rotation";
import type { z } from "zod";
import type { orgInfoSchema, rotationConfigSchema } from "@/lib/validations/hive/reference";

/**
 * HR tickets setup beyond plain rows (US-H9): the rotation anchor/weekend, the
 * org-chart details Siraaj's `hive_org_structure` tool reads, and the provider
 * spreadsheet upload. Gated on `tickets.configure` by the routes.
 *
 * @public
 */

// --- Rotation config (singleton; HIVE stored it but never read it) -----------

export { loadRotationConfig };

export async function saveRotationConfig(input: z.output<typeof rotationConfigSchema>) {
  const data = {
    anchorDate: new Date(`${input.anchorDate}T00:00:00.000Z`),
    anchorType: input.anchorType,
    timezone: input.timezone,
    weekendDays: input.weekendDays,
  };
  const where = { id: "singleton" };
  // create-or-update, never upsert (upsert bypasses the audit extension).
  const exists = await prisma.rotationConfig.findUnique({ where, select: { id: true } });
  if (exists) await prisma.rotationConfig.update({ where, data, select: { id: true } });
  else
    await prisma.rotationConfig.create({
      data: { id: "singleton", ...data },
      select: { id: true },
    });
  return loadRotationConfig();
}

// --- Org-chart details (display order) over the CORE org ----------------------

/**
 * Every core unit with its ticket org-chart details, for the editor. Core org
 * is read-only here: this only sets display order. Leaders are the units' core
 * heads (Organisation structure); a HIVE-era leader name is returned only as
 * `legacyLeader`, for a unit with no head, so HR can see who to pick.
 */
export async function listOrgInfo() {
  const [entities, directorates, departments, teams, info] = await Promise.all([
    prisma.orgEntity.findMany({
      select: {
        id: true,
        name: true,
        head: { select: { name: true, jobTitle: true, status: true } },
      },
      orderBy: { code: "asc" },
      take: 50,
    }),
    prisma.directorate.findMany({
      select: {
        id: true,
        name: true,
        entityId: true,
        head: { select: { name: true, jobTitle: true, status: true } },
      },
      orderBy: { name: "asc" },
      take: 200,
    }),
    prisma.department.findMany({
      select: {
        id: true,
        name: true,
        entityId: true,
        directorateId: true,
        head: { select: { name: true, jobTitle: true, status: true } },
      },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.team.findMany({
      select: {
        id: true,
        name: true,
        departmentId: true,
        head: { select: { name: true, jobTitle: true, status: true } },
      },
      orderBy: { name: "asc" },
      take: 500,
    }),
    prisma.hiveOrgUnitInfo.findMany({
      select: { kind: true, unitId: true, leaderName: true, leaderTitle: true, order: true },
      take: 2000,
    }),
  ]);
  const byKey = new Map(info.map((i) => [`${i.kind}:${i.unitId}`, i]));
  type Head = { name: string; jobTitle: string | null; status: string } | null;
  const withInfo = (kind: string, id: string, head: Head) => {
    const i = byKey.get(`${kind}:${id}`);
    const current = head && head.status !== "LEAVER" ? head : null;
    const legacy = i?.leaderName ? [i.leaderName, i.leaderTitle].filter(Boolean).join(", ") : null;
    return {
      head: current ? { name: current.name, jobTitle: current.jobTitle } : null,
      legacyLeader: current ? null : legacy,
      order: i?.order ?? 0,
    };
  };
  return {
    companies: entities.map(({ head, ...e }) => ({
      kind: "COMPANY" as const,
      ...e,
      ...withInfo("COMPANY", e.id, head),
    })),
    directorates: directorates.map(({ head, ...d }) => ({
      kind: "DIRECTORATE" as const,
      ...d,
      ...withInfo("DIRECTORATE", d.id, head),
    })),
    departments: departments.map(({ head, ...d }) => ({
      kind: "DEPARTMENT" as const,
      ...d,
      ...withInfo("DEPARTMENT", d.id, head),
    })),
    teams: teams.map(({ head, ...t }) => ({
      kind: "TEAM" as const,
      ...t,
      ...withInfo("TEAM", t.id, head),
    })),
  };
}

const UNIT_LOOKUP = {
  COMPANY: (id: string) => prisma.orgEntity.findFirst({ where: { id }, select: { id: true } }),
  DIRECTORATE: (id: string) =>
    prisma.directorate.findFirst({ where: { id }, select: { id: true } }),
  DEPARTMENT: (id: string) => prisma.department.findFirst({ where: { id }, select: { id: true } }),
  TEAM: (id: string) => prisma.team.findFirst({ where: { id }, select: { id: true } }),
} as const;

export async function saveOrgInfo(input: z.output<typeof orgInfoSchema>) {
  if (!(await UNIT_LOOKUP[input.kind](input.unitId))) {
    throw new OrgRuleError("unitId: that unit does not exist", 404);
  }
  const where = { kind_unitId: { kind: input.kind, unitId: input.unitId } };
  // Order only: leaders are core unit heads now (the legacy columns are never written).
  const data = { order: input.order };
  const exists = await prisma.hiveOrgUnitInfo.findUnique({ where, select: { id: true } });
  if (exists) return prisma.hiveOrgUnitInfo.update({ where, data, select: { id: true } });
  return prisma.hiveOrgUnitInfo.create({
    data: { kind: input.kind, unitId: input.unitId, ...data },
    select: { id: true },
  });
}

// --- Provider spreadsheet upload (the `hive:providers` script, as a screen) ---

/** 5 MB is far above a 464-row sheet; anything bigger is not the provider list. */
export const MAX_PROVIDER_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Import a provider sheet — the same rules as `npm run hive:providers`
 * (lib/hive/provider-import.ts): header aliases, name + location required,
 * skipped lines reported, a file with no rows changes NOTHING, `replace`
 * retires the current list first through the audited soft delete, and it is
 * one transaction.
 */
export async function importProviders(buffer: Buffer, replace: boolean) {
  const rows = firstSheetRows(await readXlsxFile(buffer));
  if (rows.length < 2)
    throw new OrgRuleError("The file has no data rows. Nothing was changed.", 400);
  const { parsed, skipped, missingColumns } = parseProviderSheet(rows);
  if (missingColumns.length > 0) {
    throw new OrgRuleError(
      `Could not find ${missingColumns.map((c) => `a "${c}"`).join(" or ")} column in the header. Nothing was changed.`,
      400,
    );
  }
  if (parsed.length === 0) {
    throw new OrgRuleError(
      `The file produced no importable rows (${skipped.length} skipped). Nothing was changed.`,
      400,
    );
  }
  const { cleared, added } = await auditedTransaction(
    async (tx) => {
      let cleared = 0;
      if (replace) {
        // `deleteMany` → the soft-delete extension's audited soft delete.
        // eslint-disable-next-line rihal-template/no-unaudited-bulk-write -- NetworkProvider is soft-deletable: the extension rewrites deleteMany into a soft delete with one audit row per record (lib/prisma/soft-delete-extension.ts); SECURITY.md §12
        cleared = (await tx.networkProvider.deleteMany({ where: { deletedAt: null } })).count;
      }
      let added = 0;
      for (const row of parsed) {
        const existing = await tx.networkProvider.findFirst({
          where: { name: row.name, location: row.location, deletedAt: null },
          select: { id: true },
        });
        if (existing) continue;
        await tx.networkProvider.create({ data: row, select: { id: true } });
        added += 1;
      }
      return { cleared, added };
      // ~464 rows, each with an audit row: well past the 5 s default.
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  const total = await prisma.networkProvider.count();
  return {
    cleared,
    added,
    alreadyPresent: parsed.length - added,
    skipped: skipped.slice(0, 50),
    skippedCount: skipped.length,
    total,
  };
}
