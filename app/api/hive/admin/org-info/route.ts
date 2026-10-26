import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { listOrgInfo, saveOrgInfo } from "@/lib/hive/services/setup";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { orgInfoSchema } from "@/lib/validations/hive/reference";

/**
 * Org-chart details for Siraaj's `hive_org_structure` tool: each core unit's
 * leader, title and display order. Core org itself is edited under
 * Admin → Organisation; this only describes it. `tickets.configure`.
 */

export const GET = withAuth(
  requireHivePermission("configure", async () => ok(await listOrgInfo())),
);

export const PUT = withRateLimit(
  withAuth(
    requireHivePermission("configure", async (req: NextRequest) => {
      const body = await readJsonBody(req);
      if (body === null) return err("Request body must be valid JSON");
      const parsed = orgInfoSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      try {
        return ok(await saveOrgInfo(parsed.data));
      } catch (e) {
        return ruleErrorResponse(e);
      }
    }),
  ),
  { id: "hive-ref-write", limit: 120, windowMs: 60_000 },
);
