import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, ok, readJsonBody } from "@/lib/api-response";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { createReference, listReference } from "@/lib/hive/services/reference";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import {
  REFERENCE_SCHEMAS,
  isReferenceResource,
  referenceQuerySchema,
} from "@/lib/validations/hive/reference";

/**
 * HR tickets reference data (US-H9): HR pairs, members, coverage, rotation
 * groups and coverage, discounts, providers. `tickets.configure` only; the
 * resource is a closed list (anything else is 404).
 */

export const GET = withRateLimit(
  withAuth(
    requireHivePermission("configure", async (req: NextRequest, ctx) => {
      const { resource } = await ctx.params;
      if (!isReferenceResource(resource)) return err("Not found.", 404);
      const query = referenceQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
      if (!query.success) return validationError(query.error);
      return ok(await listReference(resource, query.data.q, query.data.page));
    }),
  ),
  { id: "hive-ref-list", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    requireHivePermission("configure", async (req: NextRequest, ctx) => {
      const { resource } = await ctx.params;
      if (!isReferenceResource(resource)) return err("Not found.", 404);
      const body = await readJsonBody(req);
      if (body === null) return err("Request body must be valid JSON");
      const parsed = REFERENCE_SCHEMAS[resource].safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      try {
        return created(await createReference(resource, parsed.data as never));
      } catch (e) {
        return ruleErrorResponse(e);
      }
    }),
  ),
  { id: "hive-ref-write", limit: 120, windowMs: 60_000 },
);
