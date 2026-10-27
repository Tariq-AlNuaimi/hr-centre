import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { createInvite, listInvites } from "@/lib/hiring/agency-invite-admin";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import {
  agencyInviteCreateSchema,
  agencyInviteListQuerySchema,
} from "@/lib/validations/hiring/public";

/** Agency invites in scope; creating one returns the raw link ONCE (only its hash is stored). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const q = parseQuery(req, agencyInviteListQuerySchema);
      if ("response" in q) return q.response;
      return ok(await listInvites(actor, q.data));
    }),
  ),
  { id: "hiring-agency-read", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const body = await parseBody(req, agencyInviteCreateSchema);
      if ("response" in body) return body.response;
      const origin = process.env.AUTH_URL?.replace(/\/$/, "") || new URL(req.url).origin;
      const res = created(await createInvite(actor, body.data, origin));
      res.headers.set("Cache-Control", "no-store");
      return res;
    }),
  ),
  { id: "hiring-agency-write", limit: 30, windowMs: 60_000 },
);
