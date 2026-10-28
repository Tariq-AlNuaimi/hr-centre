import type { ContractType, JmlCaseType, JmlChangeType, Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { paginatedResponse, type PaginationParams } from "@/lib/pagination";
import {
  templateShapeProblem,
  type CreateTemplateInput,
  type TemplateTaskInput,
  type UpdateTemplateInput,
} from "@/lib/validations/jml/template";
import { JmlError } from "../errors";
import { criteriaScore, type ConditionFacts } from "./conditions";
import type { TemplateTaskDef } from "./generate";

/**
 * Checklist templates — one model for JOIN / MOVE / LEAVE.
 *
 * Versioning (Onboarding BR-016, Offboarding BR-OFF-026): editing the
 * definition cuts a NEW version in one transaction (old one deactivated,
 * tasks carried forward when not supplied); toggling only `active` edits in
 * place. Old versions stay — cases pin them.
 */

const TEMPLATE_TASK_SELECT = {
  id: true,
  code: true,
  name: true,
  stage: true,
  sortOrder: true,
  dateBasis: true,
  offsetDays: true,
  offsetUnit: true,
  mandatory: true,
  blocking: true,
  confirmationRequired: true,
  defaultConfirmingParty: true,
  reversalFlag: true,
  dependsOnCodes: true,
  statutory: true,
  complianceCategory: true,
  conditions: true,
  assigneeRole: true,
  appliesToExitTypes: true,
  appliesToNationality: true,
  appliesToSettlement: true,
} as const;

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  version: true,
  active: true,
  caseType: true,
  changeType: true,
  criteria: true,
  employmentScope: true,
  nationalityScope: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { cases: true, tasks: true } },
} as const;

const TEMPLATE_DETAIL_SELECT = {
  ...TEMPLATE_SELECT,
  tasks: {
    select: TEMPLATE_TASK_SELECT,
    orderBy: [{ stage: "asc" as const }, { sortOrder: "asc" as const }],
  },
};

function isUnique(e: unknown) {
  return (e as { code?: string }).code === "P2002";
}

export async function listTemplates(
  filter: { caseType?: JmlCaseType; active?: boolean; search?: string; allVersions?: boolean },
  page: PaginationParams,
) {
  const where: Prisma.JmlTaskTemplateWhereInput = {
    ...(filter.caseType ? { caseType: filter.caseType } : {}),
    ...(filter.active === undefined ? {} : { active: filter.active }),
    ...(filter.search ? { name: { contains: filter.search, mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.jmlTaskTemplate.findMany({
      where,
      select: TEMPLATE_SELECT,
      orderBy: [{ caseType: "asc" }, { name: "asc" }, { version: "desc" }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.jmlTaskTemplate.count({ where }),
  ]);
  // Latest version per name unless every version was asked for (Onboarding).
  const visible = filter.allVersions
    ? rows
    : rows.filter((r, i) => rows.findIndex((o) => o.name === r.name) === i);
  return paginatedResponse(visible, total, page);
}

export async function getTemplate(id: string) {
  const row = await prisma.jmlTaskTemplate.findUnique({
    where: { id },
    select: TEMPLATE_DETAIL_SELECT,
  });
  if (!row) throw new JmlError("Template not found", 404);
  return row;
}

function taskData(t: TemplateTaskInput) {
  return { ...t, conditions: t.conditions as Prisma.InputJsonValue };
}

export async function createTemplate(input: CreateTemplateInput) {
  try {
    return await prisma.jmlTaskTemplate.create({
      data: {
        name: input.name,
        active: input.active,
        caseType: input.caseType,
        changeType: input.changeType,
        criteria: input.criteria as Prisma.InputJsonValue,
        employmentScope: input.employmentScope,
        nationalityScope: input.nationalityScope,
        tasks: { create: input.tasks.map(taskData) },
      },
      select: TEMPLATE_DETAIL_SELECT,
    });
  } catch (e) {
    if (isUnique(e)) throw new JmlError("A template with that name and version already exists");
    throw e;
  }
}

export async function updateTemplate(id: string, input: UpdateTemplateInput) {
  const current = await getTemplate(id);
  const definitionChanged =
    input.name !== undefined ||
    input.criteria !== undefined ||
    input.tasks !== undefined ||
    input.changeType !== undefined ||
    input.employmentScope !== undefined ||
    input.nationalityScope !== undefined;

  if (!definitionChanged) {
    if (input.active === undefined) return current;
    return prisma.jmlTaskTemplate.update({
      where: { id },
      data: { active: input.active },
      select: TEMPLATE_DETAIL_SELECT,
    });
  }

  const tasks: TemplateTaskInput[] =
    input.tasks ??
    // Carried forward without ids — the new version owns new rows. The stored
    // stage is always a working stage (COMPLETED is system-only).
    current.tasks.map(
      ({ id: _id, ...t }) =>
        ({
          ...t,
          conditions: (t.conditions ?? {}) as TemplateTaskInput["conditions"],
        }) as TemplateTaskInput,
    );
  const changeType = input.changeType === undefined ? current.changeType : input.changeType;
  const problem = templateShapeProblem({ caseType: current.caseType, changeType, tasks });
  if (problem) throw new JmlError(problem, 422);

  const name = input.name ?? current.name;
  try {
    return await auditedTransaction(async (tx) => {
      await tx.jmlTaskTemplate.update({
        where: { id },
        data: { active: false },
        select: { id: true },
      });
      const latest = await tx.jmlTaskTemplate.findFirst({
        where: { name },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      return tx.jmlTaskTemplate.create({
        data: {
          name,
          version: (latest?.version ?? current.version) + 1,
          active: input.active ?? true,
          caseType: current.caseType,
          changeType,
          criteria: (input.criteria ?? current.criteria) as Prisma.InputJsonValue,
          employmentScope: input.employmentScope ?? current.employmentScope,
          nationalityScope: input.nationalityScope ?? current.nationalityScope,
          tasks: { create: tasks.map(taskData) },
        },
        select: TEMPLATE_DETAIL_SELECT,
      });
    });
  } catch (e) {
    if (isUnique(e)) throw new JmlError("Someone saved this template a moment ago — reload it");
    throw e;
  }
}

type TemplateClient = Pick<typeof prisma, "jmlTaskTemplate">;

const MAX_CANDIDATES = 200;

/**
 * JOIN (BR-004): every pinned criterion must match, the most specific wins,
 * ties → newest version, then oldest row. MOVE (R8): same scoring among the
 * templates of the change type, against the NEW placement.
 */
export async function selectJoinOrMoveTemplate(
  caseType: "JOIN" | "MOVE",
  facts: ConditionFacts,
  changeType: JmlChangeType | null,
  client: TemplateClient = prisma,
): Promise<{ id: string; name: string; version: number } | null> {
  const candidates = await client.jmlTaskTemplate.findMany({
    where: { active: true, caseType, ...(caseType === "MOVE" ? { changeType } : {}) },
    select: { id: true, name: true, version: true, criteria: true },
    orderBy: [{ version: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    take: MAX_CANDIDATES,
  });
  let best: { id: string; name: string; version: number; score: number } | null = null;
  for (const c of candidates) {
    const score = criteriaScore(c.criteria, facts);
    if (score === null) continue;
    if (!best || score > best.score) best = { id: c.id, name: c.name, version: c.version, score };
  }
  return best;
}

/**
 * LEAVE (BR-OFF-006): FULL iff permanent full-time, LIGHT otherwise (any future
 * type defaults to LIGHT). F11 fixed: the nationality scope is honoured too —
 * an exact scope beats ANY; then the highest version.
 */
export async function selectLeaveTemplate(
  employmentType: ContractType | null,
  nationality: "OMANI" | "EXPATRIATE",
  client: TemplateClient = prisma,
): Promise<{ id: string; name: string; version: number } | null> {
  const scope = employmentType === "PERMANENT" ? "FULL" : "LIGHT";
  const candidates = await client.jmlTaskTemplate.findMany({
    where: {
      active: true,
      caseType: "LEAVE",
      employmentScope: { in: [scope, "ANY"] },
      nationalityScope: { in: [nationality, "ANY"] },
    },
    select: { id: true, name: true, version: true, employmentScope: true, nationalityScope: true },
    orderBy: [{ version: "desc" }, { createdAt: "asc" }],
    take: MAX_CANDIDATES,
  });
  const rank = (c: (typeof candidates)[number]) =>
    (c.employmentScope === scope ? 2 : 0) + (c.nationalityScope === nationality ? 1 : 0);
  const sorted = [...candidates].sort((a, b) => rank(b) - rank(a) || b.version - a.version);
  return sorted[0] ?? null;
}

/** A template's tasks as generation input. */
export async function templateTaskDefs(
  templateId: string,
  client: Pick<typeof prisma, "jmlTemplateTask"> = prisma,
): Promise<TemplateTaskDef[]> {
  return client.jmlTemplateTask.findMany({
    where: { templateId },
    select: TEMPLATE_TASK_SELECT,
    orderBy: [{ stage: "asc" }, { sortOrder: "asc" }],
    take: 500,
  });
}
