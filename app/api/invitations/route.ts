import { NextRequest } from "next/server";
import { withAdminAuth, withManagerAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, created, err } from "@/lib/api-response";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { singleInvitationSchema } from "@/lib/validations/invitation";
import { listInvitations, createInvitation } from "@/lib/services/invitation";
import { InvitationStatus } from "@/generated/prisma/client";

const VALID_STATUSES = Object.values(InvitationStatus) as string[];

// List invitations (UI-SPEC D.5). Readable by any staff role (managers monitor a
// hiring round read-only); tenant-scoped, paginated, filterable by status/role.
export const GET = withManagerAuth(async (request: NextRequest, { session }) => {
  const orgId = session.user.orgId;
  if (!orgId) return err("No organization context", 400);

  const { searchParams } = request.nextUrl;
  const pagination = parsePagination(searchParams);

  const statusParam = searchParams.get("status");
  const status =
    statusParam && VALID_STATUSES.includes(statusParam)
      ? (statusParam as InvitationStatus)
      : undefined;

  const { data, total } = await listInvitations(orgId, {
    skip: pagination.skip,
    take: pagination.take,
    status,
    roleProfileId: searchParams.get("roleProfileId") ?? undefined,
  });

  return ok(paginatedResponse(data, total, pagination));
});

// Single tokenized send (UI-SPEC D.5 "Single"). Admin-only; rate-limited OUTSIDE
// the auth wrapper (a write that also sends email).
export const POST = withRateLimit(
  withAdminAuth(async (request: NextRequest, { session }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);

    const body = await request.json().catch(() => null);
    const parsed = singleInvitationSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "), 422);
    }

    const baseUrl = process.env.AUTH_URL ?? request.nextUrl.origin;
    const res = await createInvitation({
      orgId,
      userId: session.user.id,
      baseUrl,
      input: parsed.data,
    });
    if (res.status !== 201) return err(res.error, res.status);
    return created(res.result);
  }),
  { id: "invitation-send", limit: 30, windowMs: 60_000 }
);
