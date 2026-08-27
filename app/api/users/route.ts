import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { createUserSchema } from "@/lib/validations/user";
import type { Prisma } from "@/generated/prisma/client";

// Allowlist of sortable columns — prevents raw column injection via ?sort=.
const SORTABLE_COLUMNS = ["name", "email", "role", "createdAt", "lastLoginAt"] as const;
type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

const VALID_ROLES = ["ADMIN", "EDITOR", "VIEWER"] as const;

// Admin-only: the user directory (email/role/lastLogin) is not exposed to
// VIEWER/EDITOR; the users nav is also admin-gated. See SECURITY.md §3.
export const GET = withAdminAuth(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl;
  const pagination = parsePagination(searchParams);
  const search = searchParams.get("search") ?? undefined;

  const sortParam = searchParams.get("sort");
  const sortField: SortableColumn =
    sortParam && (SORTABLE_COLUMNS as readonly string[]).includes(sortParam)
      ? (sortParam as SortableColumn)
      : "createdAt";
  const order: "asc" | "desc" = searchParams.get("order") === "asc" ? "asc" : "desc";

  const roleParam = searchParams.get("role");
  const role =
    roleParam && (VALID_ROLES as readonly string[]).includes(roleParam) ? roleParam : undefined;

  const where: Prisma.UserWhereInput = {
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

export const POST = withAdminAuth(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const { email, name, password, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return err("Email already in use", 409);

  // The SOFT-DELETED half of the same question, and it needs asking separately.
  //
  // The read above runs on the audited client, which injects `deletedAt: null` —
  // so it reports "no account" for a revoked one. The unique index on `email`
  // does not respect that filter, and `create` is not hooked by the soft-delete
  // extension, so the next statement would hit a raw P2002 and surface as an
  // opaque 500.
  //
  // This was a rare edge case until ADR-069's off-boarding amendment, which
  // manufactures a soft-deleted `User` every time a provisioned employee leaves.
  // The person most likely to hit it is an admin trying to give a REHIRED
  // employee their access back — precisely the moment a 500 is least helpful.
  // Naming the remedy costs one indexed read.
  const revoked = await prisma.user.findFirst({
    where: { email, deletedAt: { not: null } },
    select: { id: true },
  });
  if (revoked) {
    return err(
      "An account for this email was revoked, not deleted — restore it from the recycling bin " +
        "rather than creating a second one. (A revoked account keeps its history and its links; " +
        "a new one would be refused by the unique email index anyway.)",
      409,
    );
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: { email, name, passwordHash, role },
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
