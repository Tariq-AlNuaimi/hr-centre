import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { updateUserSchema } from "@/lib/validations/user";

// Admin-only (matches the list route + admin-gated users nav). See SECURITY.md §3.
export const GET = withAdminAuth(async (
  _request: NextRequest,
  { params, session }
) => {
  const { id } = await params;
  // Tenant scope: an HR_ADMIN may only read users in their own org. Without the
  // orgId predicate a guessed id discloses another tenant's user (senior-review
  // HIGH, 2026-06-27). findFirst (not findUnique) so a non-id field can join the
  // where; the soft-delete extension still filters deletedAt.
  const user = await prisma.user.findFirst({
    where: { id, orgId: session.user.orgId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      image: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) return notFound("User");
  return ok(user);
});

export const PUT = withAdminAuth(async (
  request: NextRequest,
  { params, session }
) => {
  const { id } = await params;
  const body = await request.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  // Don't let an HR_ADMIN lock themselves out by self-downgrading (mirrors the
  // self-delete guard below).
  if (id === session.user.id && parsed.data.role && parsed.data.role !== "HR_ADMIN") {
    return err("Cannot change your own admin role", 400);
  }

  // Tenant scope: confirm the target is in the caller's org BEFORE mutating, so a
  // cross-tenant id can't be updated (senior-review HIGH). The subsequent
  // update-by-id is then safe (the row is proven in-org).
  const existing = await prisma.user.findFirst({ where: { id, orgId: session.user.orgId } });
  if (!existing) return notFound("User");

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.password) {
    data.passwordHash = await hashPassword(parsed.data.password);
    delete data.password;
    // Admin-set password is still a password change: revoke the target user's
    // existing sessions via the passwordChangedAt epoch (lib/auth.ts jwt).
    data.passwordChangedAt = new Date();
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return ok(user);
});

export const DELETE = withAdminAuth(async (
  _request: NextRequest,
  { params, session }
) => {
  const { id } = await params;

  if (id === session.user.id) {
    return err("Cannot delete your own account", 400);
  }

  // Tenant scope: only soft-delete a user in the caller's org (senior-review HIGH).
  const existing = await prisma.user.findFirst({ where: { id, orgId: session.user.orgId } });
  if (!existing) return notFound("User");

  await prisma.user.delete({ where: { id } });
  // Don't echo the full row back -- it carries passwordHash + other Restricted
  // fields (SECURITY.md §1). The soft-delete + audit already recorded the event.
  return ok({ id, deleted: true });
});
