import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created } from "@/lib/api-response";
import { createHiringRequest } from "@/lib/hiring/requisition-write";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { createHiringRequestSchema } from "@/lib/validations/hiring/requisition";

/** Step 1 — the hiring request: save a draft, or draft + submit for headcount approval. */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const body = await parseBody(req, createHiringRequestSchema);
      if ("response" in body) return body.response;
      return created(await createHiringRequest(actor, body.data));
    }),
  ),
  { id: "hiring-requisitions-write", limit: 60, windowMs: 60_000 },
);
