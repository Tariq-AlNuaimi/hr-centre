import { NextRequest } from "next/server";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { createUserSchema, roleForPlatformAdmin } from "@/lib/validations/user";
import type { Prisma } from "@/generated/prisma/client";

// Allowlist of sortable columns — prevents raw column injection via ?sort=.
const SORTABLE_COLUMNS = ["name", "email", "role", "createdAt", "lastLoginAt"] as const;
type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

// Admin-only: the account directory is not exposed to non-admins, and the nav
// entry is admin-gated too. See SECURITY.md §3.
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

  // ADR-070 — the filter follows the field. The screen no longer offers three
  // roles, so it no longer filters by three; `?platformAdmin=true|false` asks the
  // only question the column actually answers. Anything else is no filter at all
  // rather than an error, matching how `sort` and `order` already behave.
  const adminParam = searchParams.get("platformAdmin");
  const platformAdmin = adminParam === "true" ? true : adminParam === "false" ? false : undefined;

  const where: Prisma.UserWhereInput = {
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(platformAdmin === undefined
      ? {}
      : platformAdmin
        ? { role: "ADMIN" }
        : { role: { not: "ADMIN" } }),
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
        // ADR-070 — the §4.1 half of the same person, on the same row.
        //
        // "What can this person do?" used to need two screens and two
        // vocabularies. This is the join that lets one row answer it, and it is
        // safe HERE specifically because this endpoint is already the most
        // privileged read in the app (`withAdminAuth`, admin-only since ADR-013).
        // The same fact is deliberately NOT added to `/api/employees`, which is
        // visibility-scoped and read by every signed-in employee — see
        // ADR-070's "what was not done".
        //
        // A to-one join on a unique FK, not an N+1: `Employee.userId` is unique,
        // so this is one extra join for the whole page.
        //
        // `deletedAt` is selected but NEVER emitted — it is here to be checked.
        // The soft-delete extension filters the TOP-LEVEL `where` only
        // (lib/prisma/soft-delete-extension.ts says so, and a contract test pins
        // it), so a nested relation still surfaces soft-deleted children. Without
        // this, a deleted employee's name and HR roles would render on the account
        // row as though the record were live — on the screen an admin uses to
        // decide what to do with that account.
        employee: { select: { id: true, name: true, pmsRoles: true, deletedAt: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  // `isPlatformAdmin` is emitted ALONGSIDE `role`, not instead of it: the column
  // still exists and the recycling bin / audit log still show the stored value,
  // but every consumer that asks a yes/no question should read the boolean rather
  // than re-deriving `=== "ADMIN"` in a fourth place.
  const rows = data.map(({ employee, ...user }) => ({
    ...user,
    isPlatformAdmin: user.role === "ADMIN",
    // A soft-deleted employee reads the same as no employee record: the account
    // exists, the org record does not. Reconstructed rather than spread, so
    // `deletedAt` cannot ride along into the response.
    employee:
      employee && employee.deletedAt === null
        ? { id: employee.id, name: employee.name, pmsRoles: employee.pmsRoles }
        : null,
  }));

  return ok(paginatedResponse(rows, total, pagination));
});

export const POST = withAdminAuth(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const { email, name, password, isPlatformAdmin } = parsed.data;

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
    // ADR-070 — the boundary takes a boolean and maps it here, in one place, so
    // the stored enum and the thing a caller can ask for cannot drift apart.
    data: { email, name, passwordHash, role: roleForPlatformAdmin(isPlatformAdmin) },
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
