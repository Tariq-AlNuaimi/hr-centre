import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { resolveActor } from "@/lib/core/actor";
import { renameCompany } from "@/lib/org/units";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { renameCompanySchema } from "@/lib/validations/org";

/**
 * Rename a company (blueprint §1: companies are rename-only — the code is the
 * import key and never changes).
 */
export const PATCH = withRateLimit(
  withAuth(async (request: NextRequest, { params, session }) => {
    const { id } = await params;
    const actor = await resolveActor(session);
    if (!actor.capabilities.orgManage) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = renameCompanySchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    try {
      return ok(await renameCompany(id, parsed.data.name));
    } catch (e) {
      return ruleErrorResponse(e);
    }
  }),
  { id: "org-company-write", limit: 30, windowMs: 60_000 },
);
