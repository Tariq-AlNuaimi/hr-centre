import { prisma } from "@/lib/prisma";
import { has } from "@/lib/rbac/grants";
import { loadGrants } from "@/lib/rbac/resolve";
import { APPROVAL_ROLES, ROLE_PERMISSION } from "@/lib/hiring/access";
import type { DELEGABLE_MODULES } from "@/lib/validations/core/approvals";

/**
 * Who may delegate approvals, and to whom (ADR-094). A delegator must hold an
 * approval role in the module somewhere; a delegate must be an active login
 * who can read the module's records (`hiring.view`) — delegation passes the
 * authority to decide, never access to data the delegate could not open.
 */

type Module = (typeof DELEGABLE_MODULES)[number];

export async function canDelegateApprovals(userId: string, module: Module): Promise<boolean> {
  const grants = await loadGrants(userId);
  if (module === "hiring") return APPROVAL_ROLES.some((r) => has(grants, ROLE_PERMISSION[r]));
  return false;
}

export async function canReceiveDelegation(userId: string, module: Module): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true },
  });
  if (!user) return false;
  const grants = await loadGrants(userId);
  if (module === "hiring") return has(grants, "hiring.view");
  return false;
}
