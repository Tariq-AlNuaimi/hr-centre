import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { relinkEmployeeGrades } from "@/lib/core/catalogue/grades";
import { hasGroup } from "@/lib/rbac/grants";
import { can, holdsAnywhere, type HiringActor } from "./access";
import { HiringRuleError } from "./http";
import { toNum } from "./money";
import type { LibraryKind } from "@/lib/validations/hiring/library";

/**
 * The knowledge base — grades, competencies, JD templates, question bank. The
 * grade and competency lists are the CORE catalogues (ADR-097), shared with
 * People and Performance; Hiring is where they are edited today.
 * (Interview Hub `/competencies`, `/grades`, `/jd-templates`, `/questions`).
 * Reading needs any hiring access; writing needs `hiring.manage` over the row's
 * company, or Group scope for a group-wide row (entityId null).
 */

const LIBRARY_LIMIT = 500;

export function canReadLibrary(actor: HiringActor) {
  return holdsAnywhere(actor, "hiring.view");
}

function assertCanWriteLibrary(actor: HiringActor, entityId: string | null | undefined) {
  const ok = entityId
    ? can(actor, "hiring.manage", { entityId })
    : hasGroup(actor.grants, "hiring.manage");
  if (!ok) throw new HiringRuleError("You can't change this library entry.", 403);
}

type Row = Record<string, unknown> & { id: string; entityId?: string | null };

/* eslint-disable @typescript-eslint/no-explicit-any -- one CRUD over four delegates with identical shapes */
function delegate(kind: LibraryKind): any {
  return {
    competencies: prisma.competency,
    grades: prisma.grade,
    "jd-templates": prisma.hiringJdTemplate,
    questions: prisma.hiringQuestion,
  }[kind];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const ORDER: Record<LibraryKind, Prisma.GradeOrderByWithRelationInput[] | object[]> = {
  competencies: [{ category: "asc" }, { name: "asc" }],
  grades: [{ order: "asc" }, { code: "asc" }],
  "jd-templates": [{ title: "asc" }],
  questions: [{ roleFamily: "asc" }, { createdAt: "desc" }],
};

/** Grade bands are pay: only for readers who may see hiring pay. */
function serialize(kind: LibraryKind, row: Row, showPay = true) {
  if (kind !== "grades") return row;
  return showPay
    ? { ...row, minSalary: toNum(row.minSalary as never), maxSalary: toNum(row.maxSalary as never) }
    : { ...row, minSalary: null, maxSalary: null };
}

export function seesLibraryPay(actor: HiringActor) {
  return holdsAnywhere(actor, "hiring.viewComp");
}

export async function listLibrary(kind: LibraryKind, search: string | undefined, showPay: boolean) {
  const field = kind === "jd-templates" ? "title" : kind === "questions" ? "questionText" : "name";
  const where = search ? { [field]: { contains: search, mode: "insensitive" } } : {};
  const rows: Row[] = await delegate(kind).findMany({
    where,
    orderBy: ORDER[kind],
    take: LIBRARY_LIMIT,
  });
  return rows.map((r) => serialize(kind, r, showPay));
}

export async function getLibraryItem(kind: LibraryKind, id: string, showPay = true) {
  const row: Row | null = await delegate(kind).findUnique({ where: { id } });
  return row ? serialize(kind, row, showPay) : null;
}

/**
 * QA2 N-07 — one grade code per company. Two active `G1`s made every reader
 * that resolves a code (employee grade relink, JD templates, requisitions)
 * pick one arbitrarily. A group-wide grade (no company) clashes with every
 * company's, because a code resolves across both.
 */
async function assertGradeCodeFree(code: string, entityId: string | null, exceptId?: string) {
  const clash = await prisma.grade.findFirst({
    where: {
      code: { equals: code.trim(), mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
      ...(entityId ? { OR: [{ entityId }, { entityId: null }] } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw new HiringRuleError(`A grade with the code "${code.trim()}" already exists.`, 409);
  }
}

/**
 * QA2 N-07 — a grade still in use is not deleted from under its users: JD
 * templates and requisitions name it by code, and employees link to it.
 */
async function assertGradeUnused(id: string, code: string) {
  const [employees, templates, requisitions] = await Promise.all([
    prisma.employee.count({ where: { gradeId: id } }),
    prisma.hiringJdTemplate.count({ where: { grade: code } }),
    prisma.hiringRequisition.count({
      where: { grade: code, status: { notIn: ["CLOSED", "ARCHIVED", "FILLED"] } },
    }),
  ]);
  const uses = [
    employees ? `${employees} ${employees === 1 ? "employee" : "employees"}` : null,
    templates ? `${templates} job description ${templates === 1 ? "template" : "templates"}` : null,
    requisitions
      ? `${requisitions} open ${requisitions === 1 ? "requisition" : "requisitions"}`
      : null,
  ].filter(Boolean);
  if (uses.length > 0) {
    throw new HiringRuleError(
      `Grade ${code} is still used by ${uses.join(", ")}. Move them to another grade first.`,
      409,
    );
  }
}

export async function createLibraryItem(
  actor: HiringActor,
  kind: LibraryKind,
  data: Record<string, unknown>,
) {
  assertCanWriteLibrary(actor, data.entityId as string | null | undefined);
  if (kind === "competencies") {
    // Idempotent on a case-insensitive name (Interview Hub "Add to library").
    const existing = await prisma.competency.findFirst({
      where: { name: { equals: String(data.name), mode: "insensitive" } },
    });
    if (existing) return existing;
  }
  if (kind === "grades") {
    await assertGradeCodeFree(String(data.code), (data.entityId as string | null) ?? null);
  }
  const row = await delegate(kind).create({ data });
  if (kind === "grades") await relinkEmployeeGrades([row.code]);
  return serialize(kind, row);
}

export async function updateLibraryItem(
  actor: HiringActor,
  kind: LibraryKind,
  id: string,
  data: Record<string, unknown>,
) {
  const row = await getLibraryItem(kind, id);
  if (!row) return null;
  assertCanWriteLibrary(actor, row.entityId as string | null);
  if ("entityId" in data) assertCanWriteLibrary(actor, data.entityId as string | null);
  if (kind === "grades" && ("code" in data || "entityId" in data)) {
    await assertGradeCodeFree(
      String(data.code ?? row.code),
      (("entityId" in data ? data.entityId : row.entityId) as string | null) ?? null,
      id,
    );
  }
  const updated = await delegate(kind).update({ where: { id }, data });
  if (kind === "grades") await relinkEmployeeGrades([row.code as string, updated.code]);
  return serialize(kind, updated);
}

export async function deleteLibraryItem(actor: HiringActor, kind: LibraryKind, id: string) {
  const row = await getLibraryItem(kind, id);
  if (!row) return false;
  assertCanWriteLibrary(actor, row.entityId as string | null);
  if (kind === "grades") await assertGradeUnused(id, row.code as string);
  await delegate(kind).delete({ where: { id } });
  if (kind === "grades") await relinkEmployeeGrades([row.code as string]);
  return true;
}
