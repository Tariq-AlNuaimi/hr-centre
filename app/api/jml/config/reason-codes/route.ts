import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { listReasonCodes, saveReasonCode } from "@/lib/jml/leave/config";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { reasonCodeSchema } from "@/lib/validations/jml/leave";

/** The exit-reason taxonomy, every code (active or not). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await listReasonCodes());
    }),
  ),
  { id: "jml-config-read", limit: 60, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await saveReasonCode(await body(req, reasonCodeSchema)));
    }),
  ),
  { id: "jml-config-write", limit: 30, windowMs: 60_000 },
);
