import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { updateUserSchema, roleForPlatformAdmin } from "@/lib/validations/user";

// Admin-only (matches the list route + admin-gated users nav). See SECURITY.md §3.
export const GET = withAdminAuth(async (_request: NextRequest, { params }) => {
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
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

export const PUT = withAdminAuth(async (request: NextRequest, { params, session }) => {
  const { id } = await params;
  const body = await request.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  // Don't let an admin lock themselves out by self-downgrading (mirrors the
  // self-delete guard below).
  // ADR-070 — the request now carries a boolean; the stored enum is derived.
  const nextRole =
    parsed.data.isPlatformAdmin === undefined
      ? undefined
      : roleForPlatformAdmin(parsed.data.isPlatformAdmin);

  if (id === session.user.id && nextRole !== undefined && nextRole !== "ADMIN") {
    return err("Cannot remove your own platform administrator access", 400);
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return notFound("User");

  const data: Record<string, unknown> = { ...parsed.data };
  // `isPlatformAdmin` is the REQUEST's word; `role` is the column's. Swap it here
  // rather than letting the spread carry a key Prisma does not know — a stray
  // field on an update is a runtime error, not a type error, because `data` is
  // deliberately a loose record so the password branch below can reshape it.
  delete data.isPlatformAdmin;
  if (nextRole !== undefined) data.role = nextRole;

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

export const DELETE = withAdminAuth(async (_request: NextRequest, { params, session }) => {
  const { id } = await params;

  if (id === session.user.id) {
    return err("Cannot delete your own account", 400);
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return notFound("User");

  await prisma.user.delete({ where: { id } });
  // Don't echo the full row back -- it carries passwordHash + other Restricted
  // fields (SECURITY.md §1). The soft-delete + audit already recorded the event.
  return ok({ id, deleted: true });
});
