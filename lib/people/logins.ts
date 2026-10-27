import { randomInt } from "node:crypto";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { OrgRuleError } from "@/lib/org/rules";
import { hasDirectReports } from "@/lib/pms/org-tree";
import { assertHrAccessAdminRemains, assertPlatformAdminRemains } from "@/lib/rbac/guards";

/**
 * Logins until SSO — blueprint §4 (F-d, US-F4).
 *
 * HR issues a TEMPORARY password: generated here, returned to the caller ONCE,
 * stored only as its Argon2 hash, and flagged `mustChangePassword` so the
 * holder must replace it before anything else loads (AC-F4.1/AC-F4.2). Every
 * issue and every disable stamps `passwordChangedAt`, which the Auth.js jwt
 * callback uses to reject older sessions — so a reset or disable logs out
 * whoever held the previous password (worst path: an intercepted temporary
 * password stops working).
 */

// No 0/O, 1/l/I: it is read off a screen and typed by someone else.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let part = "";
    for (let i = 0; i < 4; i++) part += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(part);
  }
  return groups.join("-"); // 16 random symbols ≈ 92 bits
}

export type LoginState = "NONE" | "NO_PASSWORD" | "TEMPORARY" | "ACTIVE" | "REVOKED";

export function loginStateOf(
  user: { deletedAt: Date | null; passwordHash: string | null; mustChangePassword: boolean } | null,
): LoginState {
  if (!user) return "NONE";
  if (user.deletedAt) return "REVOKED";
  if (!user.passwordHash) return "NO_PASSWORD";
  return user.mustChangePassword ? "TEMPORARY" : "ACTIVE";
}

const TARGET_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  userId: true,
  user: { select: { id: true, deletedAt: true, passwordHash: true, mustChangePassword: true } },
} as const;

/**
 * AC-F4.3 — only HR-role holders and line managers get a login before SSO.
 * "HR-role holder" = the person's account holds any role assignment now.
 */
async function loginEligibility(employee: {
  id: string;
  userId: string | null;
}): Promise<{ eligible: boolean; lineManager: boolean; roleHolder: boolean }> {
  const now = new Date();
  const [lineManager, assignment] = await Promise.all([
    hasDirectReports(employee.id),
    employee.userId
      ? prisma.roleAssignment.findFirst({
          where: {
            userId: employee.userId,
            role: { deletedAt: null },
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
              { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
            ],
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  const roleHolder = assignment !== null;
  return { eligible: lineManager || roleHolder, lineManager, roleHolder };
}

export async function loginSummary(employeeId: string) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: TARGET_SELECT,
  });
  if (!employee) throw new OrgRuleError("That employee does not exist", 404);
  return {
    state: loginStateOf(employee.user),
    ...(await loginEligibility(employee)),
  };
}

/**
 * Create or reset a login and return the temporary password — the ONLY time it
 * exists outside a hash. Refused for anyone not eligible (AC-F4.3), for leavers,
 * and for a revoked account (restore it from the recycling bin first: a second
 * account on the same email is refused by the unique index anyway).
 */
export async function issueTemporaryPassword(
  employeeId: string,
  action: "create" | "reset",
): Promise<{ temporaryPassword: string; email: string }> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: TARGET_SELECT,
  });
  if (!employee) throw new OrgRuleError("That employee does not exist", 404);
  if (employee.status === "LEAVER") {
    throw new OrgRuleError("This person has left; leavers do not get a login.");
  }
  const state = loginStateOf(employee.user);
  if (state === "REVOKED") {
    throw new OrgRuleError(
      "This person's account was revoked. Restore it from the recycling bin before issuing a password.",
    );
  }
  if (action === "create" && (state === "ACTIVE" || state === "TEMPORARY")) {
    throw new OrgRuleError("This person already has a login. Use Reset instead.");
  }
  if (action === "reset" && (state === "NONE" || state === "NO_PASSWORD")) {
    throw new OrgRuleError("This person has no login to reset. Use Create instead.");
  }
  const eligibility = await loginEligibility(employee);
  if (!eligibility.eligible) {
    throw new OrgRuleError(
      "Only HR role holders and line managers get a login before single sign-on. Everyone else " +
        "signs in when SSO arrives.",
    );
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const stamp = { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() };

  await auditedTransaction(async (tx) => {
    if (employee.user) {
      await tx.user.update({ where: { id: employee.user.id }, data: stamp, select: { id: true } });
      return;
    }
    // No account yet (a record typed in before ADR-069 provisioning, say): make
    // one on the employee's work email and link it.
    const taken = await tx.user.findFirst({
      where: { email: employee.email.toLowerCase() },
      select: { id: true },
    });
    if (taken) {
      throw new OrgRuleError(
        "An account already exists for this email but is not linked to this person. Ask a " +
          "platform administrator to check Access.",
      );
    }
    const user = await tx.user.create({
      data: { email: employee.email.toLowerCase(), name: employee.name, role: "VIEWER", ...stamp },
      select: { id: true },
    });
    await tx.employee.update({ where: { id: employee.id }, data: { userId: user.id } });
  });

  return { temporaryPassword, email: employee.email };
}

/**
 * Disable: the password is removed (a passwordless record cannot sign in —
 * ADR-069) and every session is invalidated. The account stays, so SSO can link
 * to it later. Refused for oneself and if it would leave no platform admin or
 * no HR access admin able to sign in.
 */
export async function disableLogin(employeeId: string, actorUserId: string): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: TARGET_SELECT,
  });
  if (!employee) throw new OrgRuleError("That employee does not exist", 404);
  if (!employee.user || !employee.user.passwordHash) {
    throw new OrgRuleError("This person has no password login to disable.");
  }
  if (employee.user.id === actorUserId)
    throw new OrgRuleError("You cannot disable your own login.");
  await assertPlatformAdminRemains(employee.user.id);
  await assertHrAccessAdminRemains({ disabledUserId: employee.user.id });
  await prisma.user.update({
    where: { id: employee.user.id },
    data: { passwordHash: null, mustChangePassword: false, passwordChangedAt: new Date() },
    select: { id: true },
  });
}

/** The holder replaces their temporary password (AC-F4.2). */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ email: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true },
  });
  if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new OrgRuleError("currentPassword: that is not your current password", 400);
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
    select: { id: true },
  });
  return { email: user.email };
}
