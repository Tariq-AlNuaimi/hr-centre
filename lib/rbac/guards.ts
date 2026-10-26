import { prisma } from "@/lib/prisma";
import { OrgRuleError } from "@/lib/org/rules";
import type { Permission } from "./catalogue";
import { isAssignmentActive } from "./grants";

/**
 * The last-administrator guards (blueprint worst path: "the last platform admin
 * tries to remove their own admin role → refused").
 *
 * Two kinds of administrator must never drop to zero:
 *   1. a PLATFORM admin who can sign in (`User.role = ADMIN`) — the only people
 *      who can manage roles; checked on login disable.
 *   2. an HR ACCESS admin — someone holding `logins.manage` AND `people.edit`
 *      for the whole group (the starter HR Super Admin) — or HR could be locked
 *      out of giving anyone access. Checked on role edit, role deletion,
 *      assignment removal and login disable.
 *
 * Each guard compares the holders before and after a SIMULATED change and
 * refuses only a change that takes the count from some to none, so an org that
 * has not set up an HR admin yet is not blocked from doing so.
 */

const HR_ACCESS_ADMIN: readonly Permission[] = ["logins.manage", "people.edit"];

export type AccessChange = {
  /** A role's permissions are being replaced. */
  roleEdit?: { roleId: string; permissions: readonly string[] };
  /** A role is being deleted. */
  deletedRoleId?: string;
  /** An assignment is being removed. */
  removedAssignmentId?: string;
  /** A user is losing the ability to sign in. */
  disabledUserId?: string;
};

/** Users who can sign in: not deleted, and a password or a linked IdP account. */
const CAN_SIGN_IN = {
  deletedAt: null,
  OR: [{ passwordHash: { not: null } }, { accounts: { some: {} } }],
};

async function hrAccessAdmins(change: AccessChange, now: Date): Promise<Set<string>> {
  const rows = await prisma.roleAssignment.findMany({
    where: { scopeType: "GROUP", role: { deletedAt: null }, user: CAN_SIGN_IN },
    select: {
      id: true,
      userId: true,
      roleId: true,
      validFrom: true,
      validUntil: true,
      role: { select: { permissions: true } },
    },
    take: 5000,
  });
  const held = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!isAssignmentActive(r, now)) continue;
    if (r.id === change.removedAssignmentId) continue;
    if (r.roleId === change.deletedRoleId) continue;
    if (r.userId === change.disabledUserId) continue;
    const perms =
      change.roleEdit && r.roleId === change.roleEdit.roleId
        ? change.roleEdit.permissions
        : r.role.permissions;
    const set = held.get(r.userId) ?? new Set<string>();
    for (const p of perms) set.add(p);
    held.set(r.userId, set);
  }
  return new Set(
    [...held].filter(([, p]) => HR_ACCESS_ADMIN.every((x) => p.has(x))).map(([u]) => u),
  );
}

export async function assertHrAccessAdminRemains(change: AccessChange, now = new Date()) {
  const [before, after] = await Promise.all([hrAccessAdmins({}, now), hrAccessAdmins(change, now)]);
  if (before.size > 0 && after.size === 0) {
    throw new OrgRuleError(
      "Refused: this would leave nobody who can manage HR access (logins and people records " +
        "for the whole group). Give that to someone else first.",
    );
  }
}

export async function assertPlatformAdminRemains(disabledUserId: string) {
  const target = await prisma.user.findUnique({
    where: { id: disabledUserId },
    select: { role: true },
  });
  if (target?.role !== "ADMIN") return;
  const others = await prisma.user.count({
    where: { role: "ADMIN", id: { not: disabledUserId }, ...CAN_SIGN_IN },
  });
  if (others === 0) {
    throw new OrgRuleError(
      "Refused: this is the last platform administrator who can sign in. Make someone else " +
        "a platform administrator first.",
    );
  }
}
