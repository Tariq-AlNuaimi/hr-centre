import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { withAuth, withAdminAuth } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import { updateUserSchema } from "@/lib/validations/user";

export const GET = withAuth(async (
  _request: NextRequest,
  { params }
) => {
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

export const PUT = withAdminAuth(async (
  request: NextRequest,
  { params }
) => {
  const { id } = await params;
  const body = await request.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return notFound("User");

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.password) {
    data.passwordHash = await hashPassword(parsed.data.password);
    delete data.password;
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

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return notFound("User");

  const user = await prisma.user.delete({ where: { id } });
  return ok(user);
});
