import { prisma } from "@/lib/prisma";
import { emptyResult, loadLeaveRows, unsuppressed, type LeaveReport, type LeaveRow } from "./base";
import { quarterOf, ratio, suppressSmallCells, topReason, type Cell } from "./rules";

/** R1 exit reasons, R3 regrettable attrition, R4 manager and team pattern. */

const tally = (keys: readonly (string | null | undefined)[]) => {
  const m = new Map<string, number>();
  for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

async function codeLabels() {
  const rows = await prisma.leaveReasonCode.findMany({
    select: { code: true, label: true },
    take: 300,
  });
  return new Map(rows.map((r) => [r.code, r.label]));
}

export const r1Reasons: LeaveReport = {
  slug: "r1-exit-reasons",
  title: "R1 Exit reason analysis",
  run: async (ctx) => {
    const { rows, capReached } = await loadLeaveRows(ctx);
    const labels = await codeLabels();
    const coded = rows.filter((r) => r.interview?.primaryL2Code);
    const cells: Cell[] = tally(coded.map((r) => r.interview!.primaryL2Code)).map(
      ([code, exits]) => ({
        code,
        reason: labels.get(code) ?? code,
        category: coded.find((r) => r.interview!.primaryL2Code === code)!.interview!.primaryL1,
        exits,
        share: ratio(exits, coded.length),
      }),
    );
    const quarters = tally(
      rows.map((r) =>
        r.leaveDetail.lastDayOfService ? quarterOf(r.leaveDetail.lastDayOfService) : null,
      ),
    );
    // F17 fixed: secondary reasons tally the SECONDARY code, not the primary category.
    const secondary = tally(rows.map((r) => r.interview?.secondaryL2Code));
    return {
      ...emptyResult(),
      columns: [
        { key: "code", title: "Code" },
        { key: "reason", title: "Reason" },
        { key: "category", title: "Category" },
        { key: "exits", title: "Exits" },
        { key: "share", title: "Share of coded exits %" },
      ],
      cells,
      summary: [
        { label: "Exits in period", value: rows.length },
        { label: "Coded exits", value: coded.length },
        { label: "Uncoded exits", value: rows.length - coded.length },
        {
          label: "Trend by quarter",
          value:
            quarters
              .sort()
              .map(([q, n]) => `${q}: ${n}`)
              .join(", ") || null,
        },
        {
          label: "Secondary reasons",
          value: secondary.map(([c, n]) => `${labels.get(c) ?? c} (${n})`).join(", ") || null,
        },
      ],
      totalRecords: rows.length,
      capReached,
    };
  },
};

export const r3Regrettable: LeaveReport = {
  slug: "r3-regrettable",
  title: "R3 Regrettable attrition",
  run: async (ctx) => {
    const { rows, capReached } = await loadLeaveRows(ctx);
    const by = tally(rows.map((r) => r.interview?.regrettable ?? "NOT_ASSESSED"));
    const regrettable = rows.filter((r) => r.interview?.regrettable === "REGRETTABLE");
    const assessed = regrettable.filter((r) => r.interview?.preventable);
    const preventable = regrettable.filter((r) => r.interview?.preventable === "PREVENTABLE");
    // F17 fixed: prevention factors tally the FACTOR of preventable regrettable exits.
    const factors = tally(preventable.map((r) => r.interview?.preventionFactor));
    return {
      ...emptyResult(),
      columns: [
        { key: "assessment", title: "Assessment" },
        { key: "exits", title: "Exits" },
        { key: "share", title: "Share of exits %" },
      ],
      cells: by.map(([assessment, exits]) => ({
        assessment,
        exits,
        share: ratio(exits, rows.length),
      })),
      summary: [
        {
          label: "Regrettable share of all exits %",
          value: ratio(regrettable.length, rows.length),
        },
        { label: "Regrettable exits assessed for preventability", value: assessed.length },
        {
          label: "Preventable share of regrettable %",
          value: ratio(preventable.length, assessed.length),
        },
        {
          label: "Prevention factors",
          value: factors.map(([f, n]) => `${f} (${n})`).join(", ") || null,
        },
      ],
      totalRecords: rows.length,
      capReached,
    };
  },
};

function managerCells(
  rows: readonly LeaveRow[],
  teamSizes: Map<string, number>,
  labels: Map<string, string>,
): Cell[] {
  const byManager = new Map<string, LeaveRow[]>();
  for (const r of rows) {
    const id = r.leaveDetail.lineManagerEmployeeId ?? "—";
    byManager.set(id, [...(byManager.get(id) ?? []), r]);
  }
  return [...byManager.entries()].map(([id, list]) => {
    const top = topReason(list.map((r) => r.interview?.primaryL2Code ?? null));
    const team = teamSizes.get(id) ?? null;
    return {
      lineManager: list[0]!.leaveDetail.lineManager?.name ?? "No line manager",
      exits: list.length,
      topReason: top.code ? (labels.get(top.code) ?? top.code) : null,
      concentration: top.concentration,
      teamSize: team,
      exitsPerTeamMember: team ? Math.round((list.length / team) * 1000) / 1000 : null,
    };
  });
}

export const r4Managers: LeaveReport = {
  slug: "r4-manager-pattern",
  title: "R4 Manager and team pattern",
  run: async (ctx) => {
    const { rows, capReached } = await loadLeaveRows(ctx);
    const managerIds = [
      ...new Set(
        rows.map((r) => r.leaveDetail.lineManagerEmployeeId).filter((x): x is string => Boolean(x)),
      ),
    ];
    const teams = await prisma.employee.groupBy({
      by: ["managerId"],
      where: { managerId: { in: managerIds }, deletedAt: null, status: { notIn: ["PRE_JOINER"] } },
      _count: { _all: true },
    });
    const teamSizes = new Map(teams.map((t) => [t.managerId!, t._count._all]));
    let cells = managerCells(rows, teamSizes, await codeLabels()).sort(
      (a, b) => Number(b.exits) - Number(a.exits),
    );
    let suppressedCells = 0;
    // AC-14.3: R4 is ALWAYS suppressed, except for an HR Manager.
    if (!unsuppressed(ctx.actor))
      ({ cells, suppressed: suppressedCells } = suppressSmallCells(cells, "exits", "lineManager"));
    return {
      ...emptyResult(),
      columns: [
        { key: "lineManager", title: "Line manager" },
        { key: "exits", title: "Exits" },
        { key: "topReason", title: "Top reason" },
        { key: "concentration", title: "Top reason share %" },
        { key: "teamSize", title: "Current team size" },
        { key: "exitsPerTeamMember", title: "Exits per team member" },
      ],
      cells,
      unavailable: [
        {
          measure: "Team size at period start",
          needs:
            "historical reporting lines (the core record holds the current line); current team size is shown",
        },
      ],
      totalRecords: rows.length,
      capReached,
      suppressedCells,
    };
  },
};
