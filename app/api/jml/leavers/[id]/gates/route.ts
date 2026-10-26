import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { listGates, recordGate } from "@/lib/jml/leave/gates";
import { body, jml } from "@/lib/jml/route";
import { gateSchema } from "@/lib/validations/jml/leave";

/** Compliance gates C1–C11, closure check and incidents. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await listGates(actor, params.id!)))),
  { id: "jml-leavers-read", limit: 120, windowMs: 60_000 },
);

/** Record a gate, or override it with a reason (jml.overrideGates). */
export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await recordGate(actor, params.id!, await body(req, gateSchema))),
    ),
  ),
  { id: "jml-leavers-write", limit: 30, windowMs: 60_000 },
);
