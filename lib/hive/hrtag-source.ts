import { prisma } from "@/lib/prisma";
import type { CompanyRow, CoverageRow, PairRow } from "./hrtag-routing";

/**
 * The two reads HR Tag routing needs, in one place (HIVE `hrtag-source.ts`).
 * `hrtag-routing.ts` owns the RULES and stays pure; this owns the QUERIES, so
 * the `hive_find_hr_tag` tool and ticket routing can never disagree about which
 * pairs exist.
 *
 * HR Centre: companies are core `OrgEntity` rows (HIVE's own `Company` table is
 * not ported). A company's "units" — what a coverage row's optional unit link is
 * checked against — are its directorates, departments and teams. Display order
 * comes from module-owned `hive_org_unit_info` (Rihal, TP, Codeline), then name.
 *
 * @public
 */

type CoverageDb = {
  label: string;
  aliases: string[];
  entityId: string | null;
  companyWide: boolean;
  directorateId: string | null;
  departmentId: string | null;
  teamId: string | null;
};

/** A stored coverage row in the routing rules' shape (HIVE's companyId / orgUnitId). */
function toCoverageRow(c: CoverageDb): CoverageRow {
  return {
    label: c.label,
    aliases: c.aliases,
    // HIVE's `companyId` meant "company-wide routing"; it stays a separate flag.
    companyId: c.companyWide ? c.entityId : null,
    entityId: c.entityId,
    orgUnitId: c.directorateId ?? c.departmentId ?? c.teamId ?? null,
  };
}

export async function loadHrPairs(): Promise<PairRow[]> {
  const rows = await prisma.hrTagPair.findMany({
    where: { deletedAt: null },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      isDefault: true,
      members: {
        where: { deletedAt: null },
        // `order` is the column HR curates; `createdAt` is insertion order.
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { name: true, email: true, phone: true, photoKey: true },
      },
      coverage: {
        // Nested reads are NOT rewritten by the soft-delete extension, so this
        // filter is the only thing stopping a deleted row from still routing.
        // ADR-102: these are rows of the core HR coverage model that name this
        // pair; a row switched off on Admin › Settings › HR coverage stops routing.
        where: { deletedAt: null, active: true },
        select: {
          label: true,
          aliases: true,
          entityId: true,
          companyWide: true,
          directorateId: true,
          departmentId: true,
          teamId: true,
        },
      },
    },
    take: 50,
  });
  return rows.map((p) => ({ ...p, coverage: p.coverage.map(toCoverageRow) }));
}

/** Display order of companies (HIVE's `Company.order`), from `hive_org_unit_info`. */
async function companyOrder(ids: string[]): Promise<Map<string, number>> {
  const rows = await prisma.hiveOrgUnitInfo.findMany({
    where: { kind: "COMPANY", unitId: { in: ids } },
    select: { unitId: true, order: true },
    take: 50,
  });
  return new Map(rows.map((r) => [r.unitId, r.order]));
}

export async function loadCompanies(): Promise<CompanyRow[]> {
  const entities = await prisma.orgEntity.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      directorates: { where: { deletedAt: null }, select: { id: true }, take: 200 },
      departments: {
        where: { deletedAt: null },
        select: {
          id: true,
          teams: { where: { deletedAt: null }, select: { id: true }, take: 200 },
        },
        take: 500,
      },
    },
    take: 50,
  });
  const order = await companyOrder(entities.map((e) => e.id));
  return entities
    .map((e) => ({
      id: e.id,
      name: e.name,
      units: [
        ...e.directorates,
        ...e.departments.map((d) => ({ id: d.id })),
        ...e.departments.flatMap((d) => d.teams),
      ],
      order: order.get(e.id) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(({ order: _order, ...c }) => c);
}
