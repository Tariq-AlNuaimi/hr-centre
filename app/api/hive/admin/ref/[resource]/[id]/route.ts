import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { removeReference, updateReference } from "@/lib/hive/services/reference";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { REFERENCE_SCHEMAS, isReferenceResource } from "@/lib/validations/hive/reference";

/** Edit (whole row) or soft-delete one reference row — `tickets.configure` only. */

export const PATCH = withRateLimit(
  withAuth(
    requireHivePermission("configure", async (req: NextRequest, ctx) => {
      const { resource, id } = await ctx.params;
      if (!isReferenceResource(resource)) return err("Not found.", 404);
      const body = await readJsonBody(req);
      if (body === null) return err("Request body must be valid JSON");
      const parsed = REFERENCE_SCHEMAS[resource].safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      try {
        return ok(await updateReference(resource, id, parsed.data as never));
      } catch (e) {
        return ruleErrorResponse(e);
      }
    }),
  ),
  { id: "hive-ref-write", limit: 120, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    requireHivePermission("configure", async (_req: NextRequest, ctx) => {
      const { resource, id } = await ctx.params;
      if (!isReferenceResource(resource)) return err("Not found.", 404);
      try {
        await removeReference(resource, id);
        return ok({ id, deleted: true });
      } catch (e) {
        return ruleErrorResponse(e);
      }
    }),
  ),
  { id: "hive-ref-write", limit: 120, windowMs: 60_000 },
);
