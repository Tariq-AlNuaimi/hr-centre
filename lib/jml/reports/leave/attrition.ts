import { prisma } from "@/lib/prisma";
import { resolve } from "@/lib/statutory/parameters";
import { statutoryRows } from "../../leave/settlement";
import { nationalityBranch } from "../../leave/rules";
import {
  emptyResult,
  loadLeaveRows,
  orgNames,
  period,
  unsuppressed,
  type LeaveReport,
  type LeaveRow,
} from "./base";
import {
  attritionRate,
  employedOn,
  monthOf,
  ratio,
  suppressSmallCells,
  tenureBand,
  TENURE_BANDS,
  type Cell,
} from "./rules";

/**
 * R2 attrition, R5 early attrition, R8 Omanisation. The denominator is the
 * CORE employee record (joined on or before the day, not yet gone) — the
 * source needed hand-entered headcount snapshots; this port has the people.
 */

const DAY = 86_400_000;

async function workforce() {
  return prisma.employee.findMany({
    where: { deletedAt: null, status: { not: "PRE_JOINER" } },
    select: {
      dateOfJoining: true,
      lastWorkingDay: true,
      entityId: true,
      departmentId: true,
      grade: true,
      jobTitle: true,
      nationality: true,
      department: { select: { directorateId: true } },
    },
    take: 20_000,
  });
}
type Person = Awaited<ReturnType<typeof workforce>>[number];

type Segment = "month" | "company" | "directorate" | "department" | "role" | "grade" | "tenureBand";

function exitKey(r: LeaveRow, seg: Segment): string | null {
  const d = r.leaveDetail;
  switch (seg) {
    case "company":
      return d.entityIdAtExit;
    case "directorate":
      return d.directorateIdAtExit;
    case "department":
      return d.departmentIdAtExit;
    case "role":
      return d.jobTitleAtExit;
    case "grade":
      return d.gradeAtExit;
    case "tenureBand":
      return tenureBand(r.employee.dateOfJoining, d.lastDayOfService);
    default:
      return d.lastDayOfService ? monthOf(d.lastDayOfService) : null;
  }
}

function personKey(p: Person, seg: Segment): string | null {
  switch (seg) {
    case "company":
      return p.entityId;
    case "directorate":
      return p.department?.directorateId ?? null;
    case "department":
      return p.departmentId;
    case "role":
      return p.jobTitle;
    case "grade":
      return p.grade;
    default:
      return null;
  }
}

function headcount(people: readonly Person[], seg: Segment, key: string, day: Date) {
  return people.filter((p) => employedOn(p, day) && (seg === "month" || personKey(p, seg) === key))
    .length;
}

export const r2Attrition: LeaveReport = {
  slug: "r2-attrition",
  title: "R2 Attrition rate and trend",
  run: async (ctx) => {
    const seg = ctx.filters.segment as Segment;
    const { rows, capReached } = await loadLeaveRows(ctx);
    const { from, to } = period(ctx.filters, ctx.now);
    const people = await workforce();
    const names = await orgNames(rows);
    const groups = new Map<string, number>();
    for (const r of rows) {
      const k = exitKey(r, seg) ?? "Not recorded";
      groups.set(k, (groups.get(k) ?? 0) + 1);
    }
    const label = (k: string) =>
      names.entity.get(k) ?? names.directorate.get(k) ?? names.department.get(k) ?? k;
    let cells: Cell[] = [...groups.entries()].sort().map(([k, exits]) => {
      if (seg === "month") {
        const [y, m] = k.split("-").map(Number) as [number, number];
        const mFrom = new Date(Date.UTC(y, m - 1, 1));
        const mTo = new Date(Date.UTC(y, m, 0));
        const a = attritionRate(
          exits,
          headcount(people, seg, k, mFrom),
          headcount(people, seg, k, mTo),
          mTo.getUTCDate(),
        );
        return {
          segment: k,
          exits,
          averageHeadcount: a.averageHeadcount,
          attritionRatePercent: a.rate,
          annualisedPercent: a.annualised,
        };
      }
      if (seg === "tenureBand")
        return {
          segment: k,
          exits,
          averageHeadcount: null,
          attritionRatePercent: null,
          annualisedPercent: null,
        };
      const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
      const a = attritionRate(
        exits,
        headcount(people, seg, k, from),
        headcount(people, seg, k, to),
        days,
      );
      return {
        segment: label(k),
        exits,
        averageHeadcount: a.averageHeadcount,
        attritionRatePercent: a.rate,
        annualisedPercent: a.annualised,
      };
    });
    let suppressedCells = 0;
    if (["directorate", "department"].includes(seg) && !unsuppressed(ctx.actor)) {
      ({ cells, suppressed: suppressedCells } = suppressSmallCells(cells, "exits", "segment"));
    }
    const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
    const org = attritionRate(
      rows.length,
      people.filter((p) => employedOn(p, from)).length,
      people.filter((p) => employedOn(p, to)).length,
      days,
    );
    return {
      ...emptyResult(),
      columns: [
        { key: "segment", title: "Segment" },
        { key: "exits", title: "Exits" },
        { key: "averageHeadcount", title: "Average headcount" },
        { key: "attritionRatePercent", title: "Attrition %" },
        { key: "annualisedPercent", title: "Annualised %" },
      ],
      cells,
      summary: [
        { label: "Exits in period", value: rows.length },
        { label: "Organisation average headcount", value: org.averageHeadcount },
        { label: "Organisation attrition %", value: org.rate },
        { label: "Annualised %", value: org.annualised },
      ],
      unavailable:
        seg === "tenureBand"
          ? [
              {
                measure: "Rate by tenure band",
                needs: "a headcount per tenure band, which is not kept",
              },
            ]
          : [],
      totalRecords: rows.length,
      capReached,
      suppressedCells,
    };
  },
};

export const r5Early: LeaveReport = {
  slug: "r5-early-attrition",
  title: "R5 Early attrition",
  run: async (ctx) => {
    const { rows, capReached } = await loadLeaveRows(ctx);
    const banded = rows.map((r) =>
      tenureBand(r.employee.dateOfJoining, r.leaveDetail.lastDayOfService),
    );
    const withHire = banded.filter(Boolean).length;
    return {
      ...emptyResult(),
      columns: [
        { key: "tenureBand", title: "Tenure (months)" },
        { key: "exits", title: "Exits" },
        { key: "share", title: "Share %" },
      ],
      cells: TENURE_BANDS.map((b) => {
        const exits = banded.filter((x) => x === b).length;
        return { tenureBand: b, exits, share: ratio(exits, withHire) };
      }),
      summary: [
        { label: "Exits with a hire date", value: withHire },
        { label: "Exits without a hire date", value: rows.length - withHire },
        {
          label: "Left within 12 months %",
          value: ratio(banded.filter((b) => b === "0-6" || b === "7-12").length, withHire),
        },
      ],
      totalRecords: rows.length,
      capReached,
    };
  },
};

function omaniShare(people: readonly Person[], day: Date) {
  const on = people.filter((p) => employedOn(p, day));
  return {
    total: on.length,
    percent: ratio(
      on.filter((p) => nationalityBranch(p.nationality) === "OMANI").length,
      on.length,
    ),
  };
}

export const r8Omanisation: LeaveReport = {
  slug: "r8-omanisation",
  title: "R8 Omanisation impact",
  run: async (ctx) => {
    const { rows, capReached } = await loadLeaveRows(ctx);
    const { from, to } = period(ctx.filters, ctx.now);
    const people = await workforce();
    const omani = rows.filter((r) => r.leaveDetail.nationality === "OMANI").length;
    const expat = rows.length - omani;
    const opening = omaniShare(people, from);
    const closing = omaniShare(people, to);
    let target: number | null = null;
    try {
      target = resolve(await statutoryRows(), "omanisation.targetRatioPercent", to).value;
    } catch {
      target = null;
    }
    const classified = rows.filter((r) => r.leaveDetail.positionClassificationName).length;
    return {
      ...emptyResult(),
      columns: [
        { key: "nationality", title: "Branch" },
        { key: "exits", title: "Exits" },
        { key: "share", title: "Share %" },
      ],
      cells: [
        { nationality: "OMANI", exits: omani, share: ratio(omani, rows.length) },
        { nationality: "EXPATRIATE", exits: expat, share: ratio(expat, rows.length) },
      ],
      summary: [
        {
          label: "Ratio direction",
          value: omani > expat ? "DOWN" : omani < expat ? "UP" : "NEUTRAL",
        },
        { label: "Omanisation % at period start", value: opening.percent },
        { label: "Omanisation % at period end", value: closing.percent },
        {
          label: "Change (points)",
          value:
            opening.percent !== null && closing.percent !== null
              ? Math.round((closing.percent - opening.percent) * 10) / 10
              : null,
        },
        {
          label: "Below target",
          value:
            target === null || closing.percent === null
              ? null
              : closing.percent < target
                ? "YES"
                : "NO",
        },
        { label: "Exits with a position classification", value: `${classified} of ${rows.length}` },
      ],
      unavailable:
        target === null
          ? [
              {
                measure: "Below target",
                needs: 'the statutory parameter "omanisation.targetRatioPercent"',
              },
            ]
          : [],
      totalRecords: rows.length,
      capReached,
    };
  },
};
