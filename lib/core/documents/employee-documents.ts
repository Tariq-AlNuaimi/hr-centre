import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/core/actor";
import { canViewCompensation, canViewIdDocuments } from "@/lib/core/permissions";
import { canViewEvidence } from "@/lib/pms/evidence";
import { employeeHiringDocuments } from "@/lib/hiring/employee-tab";
import { jmlActor } from "@/lib/jml/access";
import { employeeJmlDocuments } from "@/lib/jml/employee-tab";

/**
 * Employee › Documents (ADR-098): one list of a person's files.
 *
 *   core        files HR keep on the record (`core_documents`) — needs
 *               `people.viewIdDocuments`; a Restricted one also needs pay access
 *   jml         letters generated on their joiner/mover/leaver cases — JML's gate
 *   performance their KPI evidence — §7.1's narrower evidence rule
 *   hiring      their hiring package documents — Hiring's gate on the requisition
 *
 * Each source answers with ITS module's own permission rule; a source the viewer
 * may not see is absent, never filtered after loading. Files stay where their
 * module keeps them, and every `href` is the module's own authorised route.
 */

export type EmployeeDocument = {
  key: string;
  source: "core" | "jml" | "performance" | "hiring";
  id: string;
  title: string;
  category: string;
  date: Date;
  href: string;
  restricted: boolean;
};

const PER_SOURCE = 50;

export async function listEmployeeDocuments(
  session: Session,
  actor: ResolvedActor,
  employee: { id: string; managerId: string | null },
  /** May edit this person's record (`people.edit` in their scope) — the caller's check. */
  canEdit: boolean,
): Promise<{ items: EmployeeDocument[]; canUpload: boolean }> {
  const seesCore = canViewIdDocuments(actor);
  const seesRestricted = canViewCompensation(actor);
  const [core, jml, evidence, hiring] = await Promise.all([
    seesCore
      ? prisma.document.findMany({
          where: { employeeId: employee.id, ...(seesRestricted ? {} : { restricted: false }) },
          orderBy: { createdAt: "desc" },
          take: PER_SOURCE,
          select: { id: true, title: true, category: true, createdAt: true, restricted: true },
        })
      : [],
    jmlActor(session).then((a) => employeeJmlDocuments(a, employee.id)),
    canViewEvidence(actor, employee)
      ? prisma.kpiEvidence.findMany({
          where: { kind: "FILE", kpi: { participant: { employeeId: employee.id } } },
          orderBy: { uploadedAt: "desc" },
          take: PER_SOURCE,
          select: { id: true, label: true, uploadedAt: true },
        })
      : [],
    employeeHiringDocuments(session, employee.id),
  ]);
  const items: EmployeeDocument[] = [
    ...core.map((d) => ({
      key: `core:${d.id}`,
      source: "core" as const,
      id: d.id,
      title: d.title,
      category: d.category,
      date: d.createdAt,
      href: `/api/employees/${employee.id}/documents/${d.id}`,
      restricted: d.restricted,
    })),
    ...jml.map((d) => ({ ...d, key: `jml:${d.id}`, source: "jml" as const, restricted: false })),
    ...evidence.map((e) => ({
      key: `performance:${e.id}`,
      source: "performance" as const,
      id: e.id,
      title: e.label,
      category: "kpiEvidence",
      date: e.uploadedAt,
      href: `/api/year-end/evidence/${e.id}`,
      restricted: false,
    })),
    ...hiring.map((d) => ({ ...d, key: `hiring:${d.id}`, source: "hiring" as const })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  return { items, canUpload: seesCore && canEdit };
}
