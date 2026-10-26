import { prisma } from "@/lib/prisma";
import { loadCaseFor, type JmlActor } from "../access";

/**
 * A case's activity — who changed what, when — from the platform audit trail,
 * for anyone who may see the case (Onboarding §15 gives every HR role the
 * audit view; HR Centre's audit screen is platform-admin only). Field NAMES
 * only, never values: values can be Restricted and are already scrubbed, but a
 * case timeline has no need for them.
 */
export async function caseActivity(actor: JmlActor, caseId: string) {
  await loadCaseFor(actor, caseId, "jml.view");
  const tasks = await prisma.jmlTask.findMany({
    where: { caseId },
    select: { id: true, code: true, name: true },
    take: 1000,
  });
  const taskName = new Map(tasks.map((t) => [t.id, `${t.code} ${t.name}`]));
  const rows = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: { in: ["JmlCase", "JmlJoinDetail", "JmlMoveDetail"] }, entityId: caseId },
        { entityType: "JmlTask", entityId: { in: tasks.map((t) => t.id) } },
      ],
    },
    orderBy: { timestamp: "desc" },
    take: 200,
    select: {
      id: true,
      entityType: true,
      entityId: true,
      action: true,
      changes: true,
      timestamp: true,
      actorEmail: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    at: r.timestamp,
    action: r.action,
    entityType: r.entityType,
    subject: r.entityType === "JmlTask" ? (taskName.get(r.entityId) ?? null) : null,
    fields:
      r.changes && typeof r.changes === "object" && !Array.isArray(r.changes)
        ? Object.keys(r.changes as Record<string, unknown>).filter((k) => k !== "updatedAt")
        : [],
    actor: r.user?.name ?? r.actorEmail ?? null,
  }));
}
