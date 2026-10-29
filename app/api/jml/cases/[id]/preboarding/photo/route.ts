import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { preboardingPhotoUrl } from "@/lib/jml/preboarding/hr";
import { jml } from "@/lib/jml/route";

/** P2-4 — a short-lived signed URL for the joiner's picture (view access to the case). */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await preboardingPhotoUrl(actor, params.id!)))),
  { id: "jml-preboarding-read", limit: 120, windowMs: 60_000 },
);
