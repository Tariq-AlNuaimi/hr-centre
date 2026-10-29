import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { resolveActor } from "@/lib/core/actor";
import { setUnitHead } from "@/lib/org/heads";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { setUnitHeadSchema } from "@/lib/validations/org";

/**
 * Set or clear the head of a company, directorate, department or team
 * (Organisation structure). Same gate as every other org-structure write.
 */
export const PUT = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgManage) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = setUnitHeadSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    try {
      return ok(await setUnitHead(parsed.data));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "org-heads-write", limit: 30, windowMs: 60_000 },
);
