import type { HiringRequisition, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/rbac/catalogue";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { can, seesComp, type HiringActor } from "./access";
import { describeFill, fillLabel, SEAT_OCCUPYING_STAGES } from "./fill-rules";
import { toNum } from "./money";
import { orgNames, peopleById, personOrNull } from "./people";
import { requisitionScopeWhere, requisitionSubject, requisitionSubjects } from "./scope";

/** Requisition reads — scope-checked loads, comp-gated serialisation, the list. */

export type LoadedRequisition = { req: HiringRequisition; subject: ScopeSubject };

/** Load a requisition the actor may `permission`; null = 404 (missing OR out of scope). */
export async function loadRequisition(
  actor: HiringActor,
  id: string,
  permission: Permission = "hiring.view",
): Promise<LoadedRequisition | null> {
  const req = await prisma.hiringRequisition.findUnique({ where: { id } });
  if (!req) return null;
  const subject = await requisitionSubject(req);
  return can(actor, permission, subject) ? { req, subject } : null;
}

/** A candidate occupies a seat by stage, or by holding an ACCEPTED offer. */
export function seatOccupancyWhere(requisitionId: string): Prisma.HiringCandidateWhereInput {
  return {
    requisitionId,
    OR: [{ stage: { in: SEAT_OCCUPYING_STAGES } }, { offers: { some: { status: "ACCEPTED" } } }],
  };
}

/** The band is Restricted pay (D19): only for comp readers / an allowed hiring manager. */
export function bandFor(actor: HiringActor, l: LoadedRequisition, routedApprover = false) {
  const visible = seesComp(actor, l.subject, {
    hiringManagerId: l.req.hiringManagerId,
    hmSeesSalary: l.req.hmSeesSalary,
    routedApprover,
  });
  return visible
    ? {
        salaryBandMin: toNum(l.req.salaryBandMin),
        salaryBandMax: toNum(l.req.salaryBandMax),
        bandHidden: false,
      }
    : { salaryBandMin: null, salaryBandMax: null, bandHidden: true };
}

/** The full requisition record for its screens, with names, fill and affordances. */
export async function requisitionDetail(actor: HiringActor, l: LoadedRequisition) {
  const r = l.req;
  const [people, org, filled, liveCareers] = await Promise.all([
    peopleById([r.hiringManagerId, r.ownerId, r.jdAuthorId]),
    orgNames([r.entityId], r.departmentId ? [r.departmentId] : []),
    prisma.hiringCandidate.count({ where: seatOccupancyWhere(r.id) }),
    prisma.hiringPosting.count({
      where: { requisitionId: r.id, channel: "CAREERS_PAGE", state: "LIVE" },
    }),
  ]);
  const fill = describeFill(r.openings, filled);
  const { salaryBandMin: _min, salaryBandMax: _max, ...rest } = r;
  void _min;
  void _max;
  return {
    ...rest,
    ...bandFor(actor, l),
    entity: org.entities.get(r.entityId) ?? null,
    departmentName: r.departmentId ? (org.departments.get(r.departmentId) ?? null) : null,
    hiringManager: personOrNull(people, r.hiringManagerId),
    owner: personOrNull(people, r.ownerId),
    jdAuthor: personOrNull(people, r.jdAuthorId),
    seatsFilled: fill.filled,
    seatsRemaining: fill.remaining,
    fillLabel: fillLabel(fill),
    liveOnCareers: liveCareers > 0,
    can: {
      manage: can(actor, "hiring.manage", l.subject),
      viewPii: can(actor, "hiring.viewPii", l.subject),
    },
  };
}

export type RequisitionListQuery = {
  search?: string;
  status?: string;
  jdStatus?: string;
  departmentId?: string;
  entityId?: string;
  grade?: string;
  salaryMin?: number;
  salaryMax?: number;
  closeFrom?: Date;
  closeTo?: Date;
  sort: "title" | "status" | "targetCloseDate" | "createdAt";
  order: "asc" | "desc";
};

function listWhere(q: RequisitionListQuery, comp: boolean): Prisma.HiringRequisitionWhereInput[] {
  const and: Prisma.HiringRequisitionWhereInput[] = [];
  if (q.search) and.push({ title: { contains: q.search, mode: "insensitive" } });
  if (q.status) and.push({ status: q.status as HiringRequisition["status"] });
  if (q.jdStatus) and.push({ jdStatus: q.jdStatus as HiringRequisition["jdStatus"] });
  if (q.departmentId) and.push({ departmentId: q.departmentId });
  if (q.entityId) and.push({ entityId: q.entityId });
  if (q.grade) and.push({ grade: q.grade });
  // Band filters only for comp readers — otherwise the filter is an oracle.
  if (comp && q.salaryMin != null) and.push({ salaryBandMax: { gte: q.salaryMin } });
  if (comp && q.salaryMax != null) and.push({ salaryBandMin: { lte: q.salaryMax } });
  if (q.closeFrom || q.closeTo) {
    and.push({
      targetCloseDate: {
        ...(q.closeFrom ? { gte: q.closeFrom } : {}),
        ...(q.closeTo ? { lte: q.closeTo } : {}),
      },
    });
  }
  return and;
}

export async function listRequisitions(
  actor: HiringActor,
  q: RequisitionListQuery,
  page: { skip: number; take: number },
) {
  const scope = await requisitionScopeWhere(actor, "hiring.view");
  if (scope === null) return { data: [], total: 0 };
  const compScope = await requisitionScopeWhere(actor, "hiring.viewComp");
  const compAll = compScope !== null && Object.keys(compScope).length === 0;
  const where: Prisma.HiringRequisitionWhereInput = { AND: [scope, ...listWhere(q, compAll)] };
  const [rows, total] = await Promise.all([
    prisma.hiringRequisition.findMany({
      where,
      skip: page.skip,
      take: page.take,
      orderBy: [{ [q.sort]: q.order }, { id: q.order }],
      omit: { description: true, businessNeed: true, alternativesConsidered: true },
      include: { _count: { select: { candidates: true } } },
    }),
    prisma.hiringRequisition.count({ where }),
  ]);
  const [people, org] = await Promise.all([
    peopleById(rows.map((r) => r.hiringManagerId)),
    orgNames(
      rows.map((r) => r.entityId),
      rows.flatMap((r) => (r.departmentId ? [r.departmentId] : [])),
    ),
  ]);
  const subjects = await requisitionSubjects(rows);
  const data = rows.map((r) => {
    const band = bandFor(actor, {
      req: r as unknown as HiringRequisition,
      subject: subjects.get(r.id)!,
    });
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      jdStatus: r.jdStatus,
      grade: r.grade,
      openings: r.openings,
      salaryCurrency: r.salaryCurrency,
      targetCloseDate: r.targetCloseDate,
      createdAt: r.createdAt,
      entity: org.entities.get(r.entityId) ?? null,
      departmentName: r.departmentId ? (org.departments.get(r.departmentId) ?? null) : null,
      hiringManager: personOrNull(people, r.hiringManagerId),
      candidateCount: r._count.candidates,
      ...band,
    };
  });
  return { data, total };
}
