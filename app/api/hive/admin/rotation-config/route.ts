import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, ok, readJsonBody } from "@/lib/api-response";
import { requireHivePermission } from "@/lib/hive/services/permissions";
import { loadRotationConfig, saveRotationConfig } from "@/lib/hive/services/setup";
import { validationError } from "@/lib/org/http";
import { rotationConfigSchema } from "@/lib/validations/hive/reference";

/** The office-rotation anchor, week type, time zone and weekend — `tickets.configure`. */

export const GET = withAuth(
  requireHivePermission("configure", async () => ok(await loadRotationConfig())),
);

export const PUT = withRateLimit(
  withAuth(
    requireHivePermission("configure", async (req: NextRequest) => {
      const body = await readJsonBody(req);
      if (body === null) return err("Request body must be valid JSON");
      const parsed = rotationConfigSchema.safeParse(body);
      if (!parsed.success) return validationError(parsed.error);
      return ok(await saveRotationConfig(parsed.data));
    }),
  ),
  { id: "hive-ref-write", limit: 120, windowMs: 60_000 },
);
