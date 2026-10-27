import type { HiringOffer, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ScopeSubject } from "@/lib/rbac/grants";
import { actsAs, can, holdsAnywhere, isHiringAdmin, seesComp, type HiringActor } from "./access";
import {
  chainFromSnapshot,
  COO_THRESHOLD_OMR,
  escalatesToCoo,
  totalMonthlyComp,
} from "./approval-chain";
import { loadApprovalConfig } from "./approval-config";
import { isUnreadable, openAmount, openJson } from "./comp-crypto";
import { toNum } from "./money";
import { orgNames, peopleById } from "./people";
import { requisitionScopeWhere, requisitionSubject, requisitionSubjects } from "./scope";
import { APPROVAL_ROLES, ROLE_PERMISSION } from "./access";
import { offerTransitions } from "./offer-rules";

/**
 * Offer reads (Interview Hub `/api/offers`, `offerToJson`). Every offer is
 * scoped through its requisition; pay is opened ONLY for a comp reader (or an
 * approver on the offer's chain), and `offerJson` asserts that before it
 * returns — the single seam every offer response goes through.
 */

const REQ_SELECT = {
  id: true,
  title: true,
  entityId: true,
  departmentId: true,
  hiringManagerId: true,
  hmSeesSalary: true,
  salaryBandMin: true,
  salaryBandMax: true,
  salaryCurrency: true,
  grade: true,
} as const;

const CAND_SELECT = {
  id: true,
  name: true,
  stage: true,
  referredById: true,
  preferredAt: true,
  requisitionId: true,
} as const;

export type OfferRow = HiringOffer & {
  candidate: {
    id: string;
    name: string;
    stage: string;
    referredById: string | null;
    preferredAt: Date | null;
    requisitionId: string | null;
  };
  requisition: Prisma.HiringRequisitionGetPayload<{ select: typeof REQ_SELECT }>;
};
export type OfferEntity = { id: string; code: string; name: string } | null;
export type LoadedOffer = {
  offer: OfferRow;
  subject: ScopeSubject;
  manage: boolean;
  comp: boolean;
  entity: OfferEntity;
};

/** Holds any approval-role permission for this subject (an approver may read the offer). */
export function isOfferApprover(
  actor: HiringActor,
  subject: ScopeSubject,
  chain?: unknown,
): boolean {
  if (isHiringAdmin(actor)) return true;
  // Only roles on the submitted chain count: before submission nobody is routed yet.
  const roles = chainFromSnapshot(chain)?.map((s) => s.role) ?? [];
  return roles.some((r) => actsAs(actor, r, subject));
}

/**
 * Load an offer the actor may read: `hiring.manage` on its requisition, or an
 * approval role there. Panel-only readers never see offers. null = 404.
 */
export async function loadOffer(
  actor: HiringActor,
  id: string,
  need: "read" | "manage" = "read",
): Promise<LoadedOffer | null> {
  const offer = await prisma.hiringOffer.findFirst({
    where: { id, deletedAt: null },
    include: { candidate: { select: CAND_SELECT }, requisition: { select: REQ_SELECT } },
  });
  if (!offer) return null;
  const subject = await requisitionSubject(offer.requisition);
  const manage = can(actor, "hiring.manage", subject);
  const approver = isOfferApprover(actor, subject, offer.approvalChain);
  if (need === "manage" ? !manage : !(manage || (approver && can(actor, "hiring.view", subject))))
    return null;
  const comp = seesComp(actor, subject, {
    hiringManagerId: offer.requisition.hiringManagerId,
    hmSeesSalary: offer.requisition.hmSeesSalary,
    routedApprover: approver,
  });
  const { entities } = await orgNames([offer.requisition.entityId], []);
  return {
    offer: offer as OfferRow,
    subject,
    manage,
    comp,
    entity: entities.get(offer.requisition.entityId) ?? null,
  };
}

/** The open pay of an offer (only call when the reader may see comp). */
export function offerPay(o: Pick<HiringOffer, "id" | "salaryEnc" | "allowancesEnc">) {
  return {
    salary: openAmount("offer", o.id, "salary", o.salaryEnc),
    allowances: openJson<Record<string, number>>("offer", o.id, "allowances", o.allowancesEnc),
    unreadable:
      isUnreadable("offer", o.id, "salary", o.salaryEnc) ||
      isUnreadable("offer", o.id, "allowances", o.allowancesEnc),
  };
}

/** THE offer projection. Fails closed: a non-comp reader can never receive a figure. */
export function offerJson(o: OfferRow, comp: boolean, entity: OfferEntity) {
  const pay = comp ? offerPay(o) : { salary: null, allowances: null, unreadable: false };
  const out = {
    id: o.id,
    status: o.status,
    startDate: o.startDate,
    probationMonths: o.probationMonths,
    noticePeriod: o.noticePeriod,
    contractType: o.contractType,
    benefits: o.benefits,
    salary: pay.salary,
    allowances: pay.allowances,
    payUnreadable: pay.unreadable,
    compHidden: !comp,
    submittedById: o.submittedById,
    joiningDate: o.joiningDate,
    noticeDetail: o.noticeDetail,
    signedFileName: o.signedFileName,
    signedSizeBytes: o.signedSizeBytes,
    signedAt: o.signedAt,
    countersignedBy: o.countersignedBy,
    countersignedAt: o.countersignedAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    candidate: { id: o.candidate.id, name: o.candidate.name, stage: o.candidate.stage },
    requisition: {
      id: o.requisition.id,
      title: o.requisition.title,
      grade: o.requisition.grade,
      entity: entity ? { code: entity.code, name: entity.name } : null,
      salaryBandMin: comp ? toNum(o.requisition.salaryBandMin) : null,
      salaryBandMax: comp ? toNum(o.requisition.salaryBandMax) : null,
    },
  };
  if (
    !comp &&
    (out.salary !== null || out.allowances !== null || out.requisition.salaryBandMin !== null)
  ) {
    throw new Error("offerJson: pay reached a reader without comp access");
  }
  return out;
}

export type OfferListQuery = {
  page: number;
  pageSize: number;
  status?: HiringOffer["status"];
  candidateId?: string;
  sort: "status" | "startDate" | "createdAt";
  order: "asc" | "desc";
};

/** The scoped list. Comp readers get the basic and the COO flag; nobody gets allowances. */
export async function listOffers(actor: HiringActor, q: OfferListQuery) {
  const readers =
    holdsAnywhere(actor, "hiring.manage") ||
    APPROVAL_ROLES.some((r) => holdsAnywhere(actor, ROLE_PERMISSION[r]));
  const scope = readers ? await requisitionScopeWhere(actor, "hiring.view") : null;
  if (scope === null) return { data: [], total: 0 };
  const where: Prisma.HiringOfferWhereInput = {
    deletedAt: null,
    requisition: scope,
    ...(q.status ? { status: q.status } : {}),
    ...(q.candidateId ? { candidateId: q.candidateId } : {}),
  };
  const [rows, total, cfg] = await Promise.all([
    prisma.hiringOffer.findMany({
      where,
      orderBy: [{ [q.sort]: q.order }, { id: q.order }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { candidate: { select: CAND_SELECT }, requisition: { select: REQ_SELECT } },
    }),
    prisma.hiringOffer.count({ where }),
    loadApprovalConfig(),
  ]);
  const subjects = await requisitionSubjects(rows.map((r) => r.requisition));
  const [people, org] = await Promise.all([
    peopleById(rows.map((r) => r.submittedById)),
    orgNames(
      rows.map((r) => r.requisition.entityId),
      [],
    ),
  ]);
  const threshold = cfg?.cooThreshold ?? COO_THRESHOLD_OMR;
  const data = rows.flatMap((r) => {
    const subject = subjects.get(r.requisition.id)!;
    const manage = can(actor, "hiring.manage", subject);
    const approver = isOfferApprover(actor, subject, r.approvalChain);
    if (!manage && !approver) return [];
    const comp = seesComp(actor, subject, {
      hiringManagerId: r.requisition.hiringManagerId,
      hmSeesSalary: r.requisition.hmSeesSalary,
      routedApprover: approver,
    });
    const pay = comp ? offerPay(r) : null;
    const j = offerJson(r as OfferRow, false, org.entities.get(r.requisition.entityId) ?? null);
    return [
      {
        ...j,
        salary: pay?.salary ?? null,
        compHidden: !comp,
        escalatesCoo: pay
          ? escalatesToCoo(totalMonthlyComp(pay.salary, pay.allowances), threshold)
          : null,
        submittedBy: r.submittedById ? (people.get(r.submittedById)?.name ?? null) : null,
      },
    ];
  });
  return { data, total };
}

/** The offer screen: the projection plus what this reader may do with it. */
export function offerDetail(l: LoadedOffer) {
  const o = l.offer;
  const live = o.status === "SENT";
  return {
    ...offerJson(o, l.comp, l.entity),
    can: {
      manage: l.manage,
      edit: l.manage && o.status === "DRAFTING",
      transitions: l.manage ? offerTransitions(o.status) : [],
      revise: l.manage && live,
      accept: l.manage && live,
      uploadSigned: l.manage && (live || o.status === "ACCEPTED"),
      letter: l.manage && l.comp,
      notes: l.comp,
      postNotes: l.manage && l.comp,
      delete: l.manage && ["DRAFTING", "WITHDRAWN", "DECLINED"].includes(o.status),
    },
  };
}
