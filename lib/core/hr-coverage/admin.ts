import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OrgRuleError } from "@/lib/org/rules";
import { hasGroup } from "@/lib/rbac/grants";
import { loadGrants } from "@/lib/rbac/resolve";
import type { HrCoverageInput } from "@/lib/validations/core/hr-coverage";
import { halvesTouched, hasCaseHalf, hasTicketHalf, levelOf } from "./rules";
import { caseSeatHolders, seatProblem, unitSubject } from "./store";

/**
 * Admin › Settings › HR coverage (ADR-102): every coverage row, both halves.
 * The ticket half (pair, words, company-wide) is edited by `tickets.configure`
 * holders; the case half (owner, supervisor, case types, priority) by
 * `jml.configure` holders; the unit and the on/off switch by whoever may edit
 * every half the row has. Both group-wide only, as in their modules. Lists are
 * bounded.
 */

export type CoverageEditor = { tickets: boolean; jml: boolean };

function assertMay(editor: CoverageEditor, need: { tickets: boolean; jml: boolean }) {
  if ((need.tickets && !editor.tickets) || (need.jml && !editor.jml)) throw new CoverageForbidden();
}

export class CoverageForbidden extends Error {
  constructor() {
    super("forbidden");
  }
}

export async function coverageEditor(userId: string): Promise<CoverageEditor> {
  const grants = await loadGrants(userId);
  return { tickets: hasGroup(grants, "tickets.configure"), jml: hasGroup(grants, "jml.configure") };
}

const ROW_SELECT = {
  id: true,
  level: true,
  entityId: true,
  directorateId: true,
  departmentId: true,
  teamId: true,
  companyWide: true,
  pairId: true,
  label: true,
  aliases: true,
  ownerUserId: true,
  supervisorUserId: true,
  caseTypes: true,
  priority: true,
  active: true,
  pair: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true, email: true } },
  supervisor: { select: { id: true, name: true, email: true } },
} as const satisfies Prisma.HrCoverageSelect;

/** The screen: every row, and what the pickers offer. */
export async function coverageView(editor: CoverageEditor) {
  const [rows, companies, directorates, departments, teams, pairs, people] = await Promise.all([
    prisma.hrCoverage.findMany({
      orderBy: [{ entityId: "asc" }, { level: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
      select: ROW_SELECT,
      take: 500,
    }),
    prisma.orgEntity.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 50,
    }),
    prisma.directorate.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, entityId: true },
      take: 500,
    }),
    prisma.department.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, entityId: true },
      take: 1000,
    }),
    prisma.team.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, department: { select: { entityId: true } } },
      take: 1000,
    }),
    prisma.hrTagPair.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
      take: 100,
    }),
    caseSeatHolders(),
  ]);
  return {
    can: editor,
    rows,
    options: {
      companies,
      directorates,
      departments,
      teams: teams.map((t) => ({ id: t.id, name: t.name, entityId: t.department.entityId })),
      pairs,
      people,
    },
  };
}

/** The company a unit belongs to — the unit must exist and match the chosen company. */
async function companyOfUnit(v: HrCoverageInput): Promise<string | null> {
  const level = levelOf(v);
  const unitId = v.teamId ?? v.departmentId ?? v.directorateId;
  if (!unitId || level === null || level === "COMPANY") {
    if (v.entityId && !(await unitSubject("COMPANY", v.entityId)))
      throw new OrgRuleError("That company does not exist", 400);
    return v.entityId ?? null;
  }
  const subject = await unitSubject(level, unitId);
  if (!subject) throw new OrgRuleError("That unit does not exist", 400);
  if (v.entityId && v.entityId !== subject.entityId)
    throw new OrgRuleError("The unit belongs to a different company", 400);
  return subject.entityId ?? null;
}

async function prepare(v: HrCoverageInput) {
  const entityId = await companyOfUnit(v);
  const level = levelOf({ ...v, entityId });
  if (v.pairId) {
    const pair = await prisma.hrTagPair.findFirst({
      where: { id: v.pairId },
      select: { id: true },
    });
    if (!pair) throw new OrgRuleError("That HR pair does not exist", 400);
  }
  if (v.ownerUserId && v.supervisorUserId) {
    if (level === null || level === "TEAM")
      throw new OrgRuleError(
        "Case owners are assigned by company, directorate or department — choose one of those",
        400,
      );
    const unitId = level === "COMPANY" ? entityId! : (v.departmentId ?? v.directorateId)!;
    const subject = await unitSubject(level, unitId);
    const problem = subject ? await seatProblem(v.ownerUserId, v.supervisorUserId, subject) : null;
    if (problem) throw new OrgRuleError(problem, 400);
  }
  return { ...v, entityId, level };
}

export async function createCoverage(editor: CoverageEditor, input: HrCoverageInput) {
  assertMay(editor, halvesTouched(null, input));
  const data = await prepare(input);
  return prisma.hrCoverage.create({ data, select: { id: true } });
}

export async function updateCoverage(editor: CoverageEditor, id: string, input: HrCoverageInput) {
  const before = await prisma.hrCoverage.findFirst({ where: { id }, select: ROW_SELECT });
  if (!before) throw new OrgRuleError("Not found", 404);
  assertMay(editor, halvesTouched(before, input));
  const data = await prepare(input);
  return prisma.hrCoverage.update({ where: { id }, data, select: { id: true } });
}

/** Soft delete (restorable from the recycling bin); needs every half the row has. */
export async function removeCoverage(editor: CoverageEditor, id: string) {
  const row = await prisma.hrCoverage.findFirst({ where: { id }, select: ROW_SELECT });
  if (!row) throw new OrgRuleError("Not found", 404);
  assertMay(editor, { tickets: hasTicketHalf(row), jml: hasCaseHalf(row) });
  await prisma.hrCoverage.delete({ where: { id } });
}
