import type { OrgUnitKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { zonedToday, utcDate, type WorkingCalendar } from "@/lib/working-time/calendar";
import { loadSchedule } from "@/lib/working-time/load";
import { OrgRuleError, departmentPlacementProblem } from "./rules";
import {
  assertDepartmentNameFree,
  assertDirectorateNameFree,
  loadDirectorate,
  renameDirectorate,
  updateOrgDepartment,
} from "./units";
import { assertDepartmentExists, assertTeamNameFree, updateTeam } from "./teams";

/**
 * P2 (UX R19) — effective-dated reorganisation: rename an org unit and/or move
 * it under a new parent "from 1 January". Scheduling writes an `OrgUnitChange`
 * row; the JML hourly sweep applies due rows through the SAME services the
 * setup screen calls (`renameDirectorate`, `updateOrgDepartment`,
 * `updateTeam`), so every placement and naming rule holds on the effective date
 * — and a rule that fails then (someone renamed another unit to the same name
 * meanwhile) marks the row FAILED with the reason instead of half-applying.
 * Rows are kept: the table is the history.
 */

export type ScheduleOrgChangeInput = {
  unitKind: OrgUnitKind;
  unitId: string;
  effectiveDate: string;
  newName?: string;
  newParentId?: string | null;
  note?: string;
  applyNow?: boolean;
};

/** QA2 N-05 — how far ahead a reorganisation may be scheduled. */
const MAX_YEARS_AHEAD = 2;

/**
 * QA2 N-05 — run the rules the apply step will run, NOW, so a change that can
 * never apply (a department moved under another company's directorate, a
 * rename onto an existing name) is refused at request time with a 400 rather
 * than accepted and FAILED days later by the sweep. The sweep still re-checks
 * on the day, because the org can change in between.
 */
async function preflight(input: ScheduleOrgChangeInput): Promise<void> {
  const name = input.newName?.trim();
  if (input.unitKind === "DIRECTORATE") {
    const d = await prisma.directorate.findUnique({
      where: { id: input.unitId },
      select: { entityId: true },
    });
    if (d && name) await assertDirectorateNameFree(d.entityId, name, input.unitId);
    return;
  }
  if (input.unitKind === "DEPARTMENT") {
    const d = await prisma.department.findUnique({
      where: { id: input.unitId },
      select: { entityId: true },
    });
    if (!d) return;
    if (input.newParentId !== undefined) {
      const directorate = await loadDirectorate(input.newParentId);
      const problem = departmentPlacementProblem({ entityId: d.entityId, directorate });
      if (problem) throw new OrgRuleError(problem, 400);
    }
    if (name) await assertDepartmentNameFree(d.entityId, name, input.unitId);
    return;
  }
  const t = await prisma.team.findUnique({
    where: { id: input.unitId },
    select: { departmentId: true },
  });
  if (!t) return;
  const departmentId = input.newParentId ?? t.departmentId;
  if (departmentId !== t.departmentId) await assertDepartmentExists(departmentId);
  if (name || departmentId !== t.departmentId) {
    await assertTeamNameFree(
      departmentId,
      name ?? (await unitNow("TEAM", input.unitId))!.name,
      input.unitId,
    );
  }
}

type UnitNow = { name: string; parentId: string | null };

async function unitNow(kind: OrgUnitKind, id: string): Promise<UnitNow | null> {
  if (kind === "DIRECTORATE") {
    const d = await prisma.directorate.findUnique({ where: { id }, select: { name: true } });
    return d ? { name: d.name, parentId: null } : null;
  }
  if (kind === "DEPARTMENT") {
    const d = await prisma.department.findUnique({
      where: { id },
      select: { name: true, directorateId: true },
    });
    return d ? { name: d.name, parentId: d.directorateId } : null;
  }
  const t = await prisma.team.findUnique({
    where: { id },
    select: { name: true, departmentId: true },
  });
  return t ? { name: t.name, parentId: t.departmentId } : null;
}

/** Schedule a change; one dated today (or earlier) applies at once. */
export async function scheduleOrgChange(input: ScheduleOrgChangeInput, userId: string | null) {
  const current = await unitNow(input.unitKind, input.unitId);
  if (!current) throw new OrgRuleError("That unit does not exist", 404);
  const { timeZone } = await loadSchedule();
  const today = zonedToday(new Date(), timeZone);
  const effective = utcDate(new Date(`${input.effectiveDate}T00:00:00Z`));
  if (Number.isNaN(effective.getTime())) {
    throw new OrgRuleError("effectiveDate: use a date (YYYY-MM-DD)", 400);
  }
  // QA2 N-05 — a past date used to apply at once without anyone deciding to.
  if (effective < today && !input.applyNow) {
    throw new OrgRuleError(
      `effectiveDate: ${input.effectiveDate} is in the past. Confirm "Apply now" to apply this change today.`,
      400,
    );
  }
  const latest = new Date(today);
  latest.setUTCFullYear(latest.getUTCFullYear() + MAX_YEARS_AHEAD);
  if (effective > latest) {
    throw new OrgRuleError(
      `effectiveDate: schedule a change at most ${MAX_YEARS_AHEAD} years ahead.`,
      400,
    );
  }
  await preflight(input);
  const row = await prisma.orgUnitChange.create({
    data: {
      unitKind: input.unitKind,
      unitId: input.unitId,
      effectiveDate: effective,
      newName: input.newName ?? null,
      moveParent: input.newParentId !== undefined,
      newParentId: input.newParentId ?? null,
      note: input.note?.trim() || null,
      createdById: userId,
    },
    select: { id: true },
  });
  if (effective <= today) await applyOrgChange(row.id);
  return prisma.orgUnitChange.findUniqueOrThrow({ where: { id: row.id }, select: CHANGE_SELECT });
}

export async function cancelOrgChange(id: string) {
  const row = await prisma.orgUnitChange.findUnique({ where: { id }, select: { status: true } });
  if (!row) throw new OrgRuleError("That change does not exist", 404);
  if (row.status !== "SCHEDULED") {
    throw new OrgRuleError("Only a scheduled change can be cancelled.", 409);
  }
  return prisma.orgUnitChange.update({
    where: { id },
    data: { status: "CANCELLED" },
    select: CHANGE_SELECT,
  });
}

const CHANGE_SELECT = {
  id: true,
  unitKind: true,
  unitId: true,
  effectiveDate: true,
  newName: true,
  moveParent: true,
  newParentId: true,
  note: true,
  status: true,
  beforeName: true,
  beforeParentId: true,
  appliedAt: true,
  failureReason: true,
  createdAt: true,
} as const;

/** Apply one row through the org services; FAILED with the reason on a rule refusal. */
async function applyOrgChange(id: string): Promise<"APPLIED" | "FAILED" | "SKIPPED"> {
  const row = await prisma.orgUnitChange.findUnique({ where: { id }, select: CHANGE_SELECT });
  if (!row || row.status !== "SCHEDULED") return "SKIPPED";
  const before = await unitNow(row.unitKind, row.unitId);
  try {
    if (!before) throw new OrgRuleError("The unit no longer exists.", 404);
    const name = row.newName ?? undefined;
    if (row.unitKind === "DIRECTORATE") {
      if (name) await renameDirectorate(row.unitId, name);
    } else if (row.unitKind === "DEPARTMENT") {
      await updateOrgDepartment(row.unitId, {
        ...(name ? { name } : {}),
        ...(row.moveParent ? { directorateId: row.newParentId } : {}),
      });
    } else {
      await updateTeam(row.unitId, {
        ...(name ? { name } : {}),
        ...(row.moveParent && row.newParentId ? { departmentId: row.newParentId } : {}),
      });
    }
  } catch (e) {
    if (!(e instanceof OrgRuleError)) throw e;
    await prisma.orgUnitChange.update({
      where: { id },
      data: { status: "FAILED", failureReason: e.message.slice(0, 300), appliedAt: new Date() },
      select: { id: true },
    });
    return "FAILED";
  }
  await prisma.orgUnitChange.update({
    where: { id },
    data: {
      status: "APPLIED",
      appliedAt: new Date(),
      beforeName: before.name,
      beforeParentId: before.parentId,
    },
    select: { id: true },
  });
  return "APPLIED";
}

/** Sweep step: every scheduled change due by today (organisation zone), oldest first. */
export async function applyDueOrgChanges({
  now,
  calendar,
}: {
  now: Date;
  calendar: WorkingCalendar;
}) {
  const today = zonedToday(now, calendar.schedule.timeZone);
  const due = await prisma.orgUnitChange.findMany({
    where: { status: "SCHEDULED", effectiveDate: { lte: today } },
    orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
    select: { id: true },
    take: 50,
  });
  const out = { applied: 0, failed: 0 };
  for (const r of due) {
    const result = await applyOrgChange(r.id);
    if (result === "APPLIED") out.applied += 1;
    if (result === "FAILED") out.failed += 1;
  }
  return out;
}

/**
 * The reorganisation screen: what is scheduled, and the recent history, with
 * unit and parent names resolved in three batched reads (no N+1).
 */
export async function listOrgChanges() {
  const [scheduled, history] = await Promise.all([
    prisma.orgUnitChange.findMany({
      where: { status: "SCHEDULED" },
      orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
      select: CHANGE_SELECT,
      take: 100,
    }),
    prisma.orgUnitChange.findMany({
      where: { status: { not: "SCHEDULED" } },
      orderBy: { updatedAt: "desc" },
      select: CHANGE_SELECT,
      take: 100,
    }),
  ]);
  const all = [...scheduled, ...history];
  const ids = (kind: OrgUnitKind) => [
    ...new Set(
      all.flatMap((c) => {
        const out: string[] = [];
        if (c.unitKind === kind) out.push(c.unitId);
        const parentKind: OrgUnitKind | null =
          c.unitKind === "DEPARTMENT" ? "DIRECTORATE" : c.unitKind === "TEAM" ? "DEPARTMENT" : null;
        if (parentKind === kind) {
          if (c.newParentId) out.push(c.newParentId);
          if (c.beforeParentId) out.push(c.beforeParentId);
        }
        return out;
      }),
    ),
  ];
  const [dirs, depts, teams] = await Promise.all([
    prisma.directorate.findMany({
      where: { id: { in: ids("DIRECTORATE") } },
      select: { id: true, name: true },
      take: 400,
    }),
    prisma.department.findMany({
      where: { id: { in: ids("DEPARTMENT") } },
      select: { id: true, name: true },
      take: 400,
    }),
    prisma.team.findMany({
      where: { id: { in: ids("TEAM") } },
      select: { id: true, name: true },
      take: 400,
    }),
  ]);
  const names = new Map([...dirs, ...depts, ...teams].map((u) => [u.id, u.name]));
  const view = (c: (typeof all)[number]) => ({
    ...c,
    unitName: names.get(c.unitId) ?? null,
    newParentName: c.newParentId ? (names.get(c.newParentId) ?? null) : null,
    beforeParentName: c.beforeParentId ? (names.get(c.beforeParentId) ?? null) : null,
  });
  return { scheduled: scheduled.map(view), history: history.map(view) };
}
