import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { createUserSchema } from "@/lib/validations/user";
import type { Prisma } from "@/generated/prisma/client";

// Allowlist of sortable columns — prevents raw column injection via ?sort=.
const SORTABLE_COLUMNS = [
  "name",
  "email",
  "role",
  "createdAt",
  "lastLoginAt",
] as const;
type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

const VALID_ROLES = ["HR_ADMIN", "HIRING_MANAGER"] as const;

// Admin-only + tenant-scoped: the user directory (email/role/lastLogin) is
// visible only to HR_ADMIN, and only within the caller's organization. See
// SECURITY.md §3 / ARCHITECTURE §8.
export const GET = withAdminAuth(async (request: NextRequest, { session }) => {
  const { searchParams } = request.nextUrl;
  const pagination = parsePagination(searchParams);
  const search = searchParams.get("search") ?? undefined;

  const sortParam = searchParams.get("sort");
  const sortField: SortableColumn =
    sortParam && (SORTABLE_COLUMNS as readonly string[]).includes(sortParam)
      ? (sortParam as SortableColumn)
      : "createdAt";
  const order: "asc" | "desc" =
    searchParams.get("order") === "asc" ? "asc" : "desc";

  const roleParam = searchParams.get("role");
  const role =
    roleParam && (VALID_ROLES as readonly string[]).includes(roleParam)
      ? roleParam
      : undefined;

  const where: Prisma.UserWhereInput = {
    orgId: session.user.orgId,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(role ? { role: role as Prisma.UserWhereInput["role"] } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { [sortField]: order },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        image: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return ok(paginatedResponse(data, total, pagination));
});

export const POST = withAdminAuth(async (request: NextRequest, { session }) => {
  const body = await request.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const { email, name, password, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return err("Email already in use", 409);

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    // New users join the creating admin's organization (tenant scoping).
    data: { email, name, passwordHash, role, orgId: session.user.orgId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  return created(user);
});
