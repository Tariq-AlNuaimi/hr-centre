/**
 * Test double: HIVE's org fixtures (a flat `Company` + `OrgUnit` tree, coverage
 * with `companyId` / `orgUnitId`) served through HR Centre's CORE org delegates
 * (OrgEntity → Directorate → Department → Team, + hive_org_unit_info), so the
 * ported HIVE contract tests keep their fixtures while exercising the HR Centre
 * queries (lib/hive/hrtag-source.ts, tools/orgchart.ts, tools/rotation.ts).
 *
 * Mapping (ADR-079): DIRECTORATE → Directorate; a parentless DEPARTMENT →
 * Department with no directorate; a TEAM under a directorate → Department under
 * it; a TEAM under a department → Team. Leaders and fixture order → info rows.
 */

export type HiveCompany = { id: string; name: string; units: { id: string }[] };
export type HiveUnit = {
  id: string;
  name: string;
  kind: string;
  leaderName: string | null;
  leaderTitle: string | null;
  parentId: string | null;
};
export type HiveCoverage = {
  label: string;
  aliases: string[];
  companyId: string | null;
  orgUnitId: string | null;
};

/** HIVE coverage → the stored HR Centre row (company-wide flag kept separate). */
export function coverageToDb(c: HiveCoverage) {
  return {
    label: c.label,
    aliases: c.aliases,
    entityId: c.companyId,
    companyWide: c.companyId !== null,
    directorateId: c.orgUnitId,
    departmentId: null,
  };
}

export function pairsToDb<P extends { coverage: HiveCoverage[] }>(pairs: P[]) {
  return pairs.map((p) => ({ ...p, coverage: p.coverage.map(coverageToDb) }));
}

/** Core-org prisma delegates over HIVE fixtures. */
export function orgDouble(companies: HiveCompany[], units: Record<string, HiveUnit[]>) {
  // A company whose units the fixture lists only as ids (routing fixtures) gets
  // them as directorates, so unit-linked coverage still scopes to it.
  const listed = { ...units };
  for (const c of companies) {
    if (!listed[c.id] && c.units.length > 0) {
      listed[c.id] = c.units.map((u) => ({
        id: u.id,
        name: u.id,
        kind: "DIRECTORATE",
        leaderName: null,
        leaderTitle: null,
        parentId: null,
      }));
    }
  }
  const all = Object.entries(listed).flatMap(([companyId, list]) =>
    list.map((u, i) => ({ ...u, companyId, order: i + 1 })),
  );
  const byId = new Map(all.map((u) => [u.id, u]));
  const isDirectorate = (u: { kind: string }) => u.kind === "DIRECTORATE";
  // A unit is a core Department when it is a top-level DEPARTMENT, or a TEAM
  // whose parent is a directorate — or whose parent is GONE (orphan).
  const isDepartment = (u: HiveUnit) => {
    if (isDirectorate(u)) return false;
    if (u.parentId === null) return true;
    const parent = byId.get(u.parentId);
    return !parent || isDirectorate(parent);
  };
  const directoratesOf = (entityId: string) =>
    all.filter((u) => u.companyId === entityId && isDirectorate(u));
  const departmentsOf = (entityId: string) =>
    all
      .filter((u) => u.companyId === entityId && isDepartment(u))
      .map((d) => ({
        id: d.id,
        name: d.name,
        // A parent that does not exist is a retired directorate's dangling id.
        directorateId: d.parentId,
        teams: all
          .filter((t) => t.parentId === d.id && !isDepartment(t) && !isDirectorate(t))
          .map((t) => ({ id: t.id, name: t.name })),
      }));
  return {
    orgEntity: {
      findMany: async () =>
        companies.map((c) => ({
          id: c.id,
          name: c.name,
          directorates: directoratesOf(c.id).map((d) => ({ id: d.id })),
          departments: departmentsOf(c.id).map((d) => ({ id: d.id, teams: d.teams })),
        })),
      findFirst: async ({ where }: { where: { id?: string; name?: { equals: string } } }) => {
        const c = where.id
          ? companies.find((x) => x.id === where.id)
          : companies.find((x) => x.name.toLowerCase() === where.name?.equals.toLowerCase());
        if (!c) return null;
        return {
          id: c.id,
          name: c.name,
          directorates: directoratesOf(c.id).map((d) => ({ id: d.id })),
          departments: departmentsOf(c.id).map((d) => ({ id: d.id })),
        };
      },
    },
    directorate: {
      findMany: async ({ where }: { where: { entityId: string } }) =>
        directoratesOf(where.entityId).map((d) => ({ id: d.id, name: d.name })),
    },
    department: {
      findMany: async ({ where }: { where: { entityId: string } }) => departmentsOf(where.entityId),
    },
    hiveOrgUnitInfo: {
      findMany: async ({ where }: { where: { kind?: string; unitId: { in: string[] } } }) => {
        if (where.kind === "COMPANY") {
          return companies
            .map((c, i) => ({ unitId: c.id, order: i + 1 }))
            .filter((r) => where.unitId.in.includes(r.unitId));
        }
        return all
          .filter((u) => where.unitId.in.includes(u.id))
          .map((u) => ({
            unitId: u.id,
            leaderName: u.leaderName,
            leaderTitle: u.leaderTitle,
            order: u.order,
          }));
      },
    },
  };
}
