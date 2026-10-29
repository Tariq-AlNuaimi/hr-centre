import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { can } from "./access";
import { resolveHiringActor } from "./actor";
import { requisitionSubject } from "./scope";

/**
 * The "Hiring" tab on the employee record (F-e): how this person was hired —
 * the requisition, source, dates, the stage path, interviews, the accepted
 * offer's dates (never pay — the record's own compensation gate covers that)
 * and the step-14 handover. Only for someone with `hiring.view` on the
 * requisition, and only when the person came through Hiring.
 */
export async function employeeHiring(session: Session, employeeId: string) {
  const c = await prisma.hiringCandidate.findFirst({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      source: true,
      createdAt: true,
      stage: true,
      requisition: { select: { id: true, title: true, entityId: true, departmentId: true } },
    },
  });
  if (!c?.requisition) return null;
  const actor = await resolveHiringActor(session);
  if (!can(actor, "hiring.view", await requisitionSubject(c.requisition))) return null;
  const [history, interviews, offer, handover] = await Promise.all([
    prisma.hiringStageHistory.findMany({
      where: { candidateId: c.id },
      orderBy: { movedAt: "asc" },
      take: 100,
      select: { id: true, toStage: true, movedAt: true },
    }),
    prisma.hiringInterview.findMany({
      where: { candidateId: c.id },
      orderBy: { scheduledDate: "asc" },
      take: 50,
      select: { id: true, round: true, scheduledDate: true, status: true },
    }),
    prisma.hiringOffer.findFirst({
      where: { candidateId: c.id, status: "ACCEPTED" },
      select: { id: true, startDate: true, joiningDate: true, signedAt: true, contractType: true },
    }),
    prisma.hiringHandover.findUnique({
      where: { candidateId: c.id },
      select: { kind: true, completedAt: true, toUserId: true },
    }),
  ]);
  const to = handover
    ? await prisma.user.findUnique({
        where: { id: handover.toUserId },
        select: { name: true, email: true },
      })
    : null;
  return {
    candidateId: c.id,
    requisition: { id: c.requisition.id, title: c.requisition.title },
    source: c.source,
    appliedAt: c.createdAt,
    stage: c.stage,
    history,
    interviews,
    offer,
    handover: handover
      ? {
          kind: handover.kind,
          completedAt: handover.completedAt,
          to: to?.name ?? to?.email ?? null,
        }
      : null,
    canOpen: can(actor, "hiring.manage", await requisitionSubject(c.requisition)),
  };
}

export type EmployeeHiring = NonNullable<Awaited<ReturnType<typeof employeeHiring>>>;

/** Visibility for the tab strip: the person came through Hiring AND the viewer may see that requisition. */
export async function hiringTabVisible(session: Session, employeeId: string): Promise<boolean> {
  const c = await prisma.hiringCandidate.findFirst({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
    select: { requisition: { select: { entityId: true, departmentId: true } } },
  });
  if (!c?.requisition) return false;
  const actor = await resolveHiringActor(session);
  return can(actor, "hiring.view", await requisitionSubject(c.requisition));
}

/** Pay evidence (Restricted) — listed only to readers with hiring pay access. */
const PAY_KINDS = new Set(["PAYSLIP", "BANK_STATEMENT"]);

/**
 * Employee › Documents (ADR-098): the package documents this person brought
 * through Hiring — for a viewer who manages that requisition; payslips and bank
 * statements only with hiring pay access. Opened on the candidate's page.
 */
export async function employeeHiringDocuments(session: Session, employeeId: string) {
  const c = await prisma.hiringCandidate.findFirst({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
    select: { id: true, requisition: { select: { entityId: true, departmentId: true } } },
  });
  if (!c?.requisition) return [];
  const actor = await resolveHiringActor(session);
  const subject = await requisitionSubject(c.requisition);
  if (!can(actor, "hiring.manage", subject)) return [];
  const pay = can(actor, "hiring.viewComp", subject);
  const docs = await prisma.hiringCandidateDocument.findMany({
    where: { candidateId: c.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, kind: true, label: true, createdAt: true },
  });
  return docs
    .filter((d) => pay || !PAY_KINDS.has(d.kind))
    .map((d) => ({
      id: d.id,
      title: d.label,
      category: d.kind,
      date: d.createdAt,
      href: `/hiring/candidates/${c.id}`,
      restricted: PAY_KINDS.has(d.kind),
    }));
}
