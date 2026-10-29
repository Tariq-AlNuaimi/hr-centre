import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/core/actor";
import {
  actorCan,
  canViewCompensation,
  canViewEmployee,
  canViewIdDocuments,
} from "@/lib/core/permissions";
import { visibilityDescendants } from "@/lib/pms/org-tree";
import { placementOf } from "@/lib/rbac/resolve";

/**
 * Who may do what with a person's core documents (ADR-098): see the person
 * (§4.2) AND hold `people.viewIdDocuments`; a Restricted file also needs pay
 * access; uploading or removing also needs `people.edit` in their scope.
 * Anything short of seeing them is null — the route answers 404.
 */
export async function documentAccess(session: Session, employeeId: string) {
  const actor = await resolveActor(session);
  const descendants = await visibilityDescendants(actor);
  if (!canViewEmployee(actor, employeeId, descendants) || !canViewIdDocuments(actor)) return null;
  const [placement, employee] = await Promise.all([
    placementOf(employeeId),
    prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }),
  ]);
  if (!placement || !employee) return null;
  return {
    actor,
    restricted: canViewCompensation(actor),
    edit: actorCan(actor, "people.edit", placement),
  };
}
