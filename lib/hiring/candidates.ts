import type { HiringCandidate, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/rbac/catalogue";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { can, holdsAnywhere, isPanelOnly, seesComp, seesPii, type HiringActor } from "./access";
import { resolveInterviewCountBounds } from "./candidate-rules";
import { candidateScopeWhere, requisitionSubject, requisitionSubjects } from "./scope";
import type { CandidateListQuery } from "@/lib/validations/hiring/candidate";

/**
 * Candidate reads: scope-checked loads and the list. A candidate's scope is
 * its requisition's; a candidate with no requisition (a talent-pool CV) is
 * Group-only. Out of scope = 404, never 403 (no existence oracle).
 *
 * Projections (AC3.4): lists never carry NEC, DEI, profile, AI rationale or any
 * free-text note for anyone; without `hiring.viewPii` a reader also loses
 * contact details and the fit score (Interview Hub's VIEWER list).
 */

export const DETACHED_SUBJECT: ScopeSubject = {
  entityId: null,
  departmentId: null,
  directorateId: null,
};

export type CandidateRequisition = {
  id: string;
  title: string;
  entityId: string;
  departmentId: string | null;
  hiringManagerId: string;
  hmSeesSalary: boolean;
  grade: string | null;
  salaryBandMin: Prisma.Decimal | null;
  salaryBandMax: Prisma.Decimal | null;
  salaryCurrency: string;
  status: string;
};

export const REQ_SELECT = {
  id: true,
  title: true,
  entityId: true,
  departmentId: true,
  hiringManagerId: true,
  hmSeesSalary: true,
  grade: true,
  salaryBandMin: true,
  salaryBandMax: true,
  salaryCurrency: true,
  status: true,
} as const;

export type LoadedCandidate = {
  cand: HiringCandidate & { requisition: CandidateRequisition | null };
  subject: ScopeSubject;
};

/** Is the actor on a (live) interview panel for this candidate? */
export async function isAssignedPanelist(actor: HiringActor, candidateId: string) {
  const n = await prisma.hiringInterview.count({
    where: { candidateId, panelists: { some: { userId: actor.userId } } },
  });
  return n > 0;
}

/** Load a candidate the actor may `permission`; null = 404 (missing OR out of scope). */
export async function loadCandidate(
  actor: HiringActor,
  id: string,
  permission: Permission = "hiring.view",
): Promise<LoadedCandidate | null> {
  const cand = await prisma.hiringCandidate.findUnique({
    where: { id },
    include: { requisition: { select: REQ_SELECT } },
  });
  if (!cand || cand.erasedAt) return null;
  const subject = cand.requisition ? await requisitionSubject(cand.requisition) : DETACHED_SUBJECT;
  if (!can(actor, permission, subject)) return null;
  // A panel-only reader sees only the candidates they interview.
  if (permission === "hiring.view" && isPanelOnly(actor, subject)) {
    if (!(await isAssignedPanelist(actor, id))) return null;
  }
  return { cand, subject };
}

/** Comp on a candidate (expectation, documents' amounts) follows the requisition's rules. */
export function seesCandidateComp(actor: HiringActor, l: LoadedCandidate) {
  return seesComp(actor, l.subject, {
    hiringManagerId: l.cand.requisition?.hiringManagerId,
    hmSeesSalary: l.cand.requisition?.hmSeesSalary,
  });
}

/** The actor's candidate filter for `permission`, panel-only readers narrowed to their panels. */
export async function candidateReadWhere(
  actor: HiringActor,
  permission: Permission = "hiring.view",
): Promise<Prisma.HiringCandidateWhereInput | null> {
  const scope = await candidateScopeWhere(actor, permission);
  if (scope === null) return null;
  const panelOnly =
    !holdsAnywhere(actor, "hiring.manage") && holdsAnywhere(actor, "hiring.panelist");
  const base: Prisma.HiringCandidateWhereInput = { AND: [scope, { erasedAt: null }] };
  if (!panelOnly) return base;
  return {
    AND: [base, { interviews: { some: { panelists: { some: { userId: actor.userId } } } } }],
  };
}

function listFilters(
  q: CandidateListQuery,
  scoreFilter: boolean,
): Prisma.HiringCandidateWhereInput[] {
  const and: Prisma.HiringCandidateWhereInput[] = [];
  if (q.search) {
    and.push({
      OR: [
        { name: { contains: q.search, mode: "insensitive" } },
        { email: { contains: q.search, mode: "insensitive" } },
      ],
    });
  }
  if (q.stage) and.push({ stage: q.stage });
  if (q.source) and.push({ source: q.source });
  if (q.requisitionId) and.push({ requisitionId: q.requisitionId });
  if (q.grade) and.push({ requisition: { grade: q.grade } });
  // The score filter is an oracle for readers who cannot see scores.
  if (scoreFilter && (q.scoreMin != null || q.scoreMax != null)) {
    and.push({
      overallScore: {
        ...(q.scoreMin != null ? { gte: q.scoreMin } : { gt: 0 }),
        ...(q.scoreMax != null ? { lte: q.scoreMax } : {}),
      },
    });
  }
  if (q.createdFrom || q.createdTo) {
    and.push({
      createdAt: {
        ...(q.createdFrom ? { gte: q.createdFrom } : {}),
        ...(q.createdTo ? { lte: q.createdTo } : {}),
      },
    });
  }
  return and;
}

async function interviewCountFilter(
  q: CandidateListQuery,
): Promise<Prisma.HiringCandidateWhereInput | null> {
  const bounds = resolveInterviewCountBounds(q.interviewCountMin, q.interviewCountMax);
  if (!bounds) return null;
  const grouped = await prisma.hiringInterview.groupBy({
    by: ["candidateId"],
    _count: { candidateId: true },
    having: {
      candidateId: {
        _count: { gte: bounds.gte, ...(bounds.lte != null ? { lte: bounds.lte } : {}) },
      },
    },
    take: 5000,
  });
  const ids = grouped.map((g) => g.candidateId);
  return bounds.includeZero
    ? { OR: [{ id: { in: ids } }, { interviews: { none: {} } }] }
    : { id: { in: ids } };
}

export const LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  nationality: true,
  currentEmployer: true,
  stage: true,
  source: true,
  overallScore: true,
  createdAt: true,
  updatedAt: true,
  requisition: { select: { id: true, title: true, entityId: true, departmentId: true } },
} as const;

export async function listCandidates(actor: HiringActor, q: CandidateListQuery) {
  const scope = await candidateReadWhere(actor);
  if (scope === null) return { data: [], total: 0 };
  const scoreFilter = holdsAnywhere(actor, "hiring.viewPii");
  const count = await interviewCountFilter(q);
  const where: Prisma.HiringCandidateWhereInput = {
    AND: [scope, ...listFilters(q, scoreFilter), ...(count ? [count] : [])],
  };
  const [rows, total] = await Promise.all([
    prisma.hiringCandidate.findMany({
      where,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      orderBy: [{ [q.sort]: q.order }, { id: q.order }],
      select: LIST_SELECT,
    }),
    prisma.hiringCandidate.count({ where }),
  ]);
  // The list never carries nationality: a protected attribute beside every name
  // on a screening list invites bias (UX review P0-2). The board keeps its own
  // Omanisation marker; the profile shows nationality in its Sensitive section.
  const data = (await projectRows(actor, rows)).map(({ nationality: _omit, ...row }) => row);
  return { data, total };
}

type ListRow = Prisma.HiringCandidateGetPayload<{ select: typeof LIST_SELECT }>;

/** Per-row PII projection, one department query for all subjects (no N+1). */
export async function projectRows(actor: HiringActor, rows: ListRow[]) {
  const reqs = rows.flatMap((r) => (r.requisition ? [r.requisition] : []));
  const subjects = await requisitionSubjects(reqs);
  return rows.map((r) => {
    const subject = r.requisition ? subjects.get(r.requisition.id)! : DETACHED_SUBJECT;
    const pii = seesPii(actor, subject);
    return {
      id: r.id,
      name: r.name,
      stage: r.stage,
      source: r.source,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      requisition: r.requisition ? { id: r.requisition.id, title: r.requisition.title } : null,
      email: pii ? r.email : null,
      nationality: pii ? r.nationality : null,
      currentEmployer: pii ? r.currentEmployer : null,
      overallScore: pii ? r.overallScore : null,
    };
  });
}
