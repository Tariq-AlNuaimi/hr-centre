import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { resubmitToIt } from "@/lib/jml/join/actions";
import { jml } from "@/lib/jml/route";

/** Submit (again) to the IT intake — off unless configured and approved (gate G6). */
export const POST = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await resubmitToIt(actor, params.id!)))),
  { id: "jml-it-intake", limit: 5, windowMs: 60_000 },
);
