import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { activateJoiner, previewActivation } from "@/lib/jml/join/activation";
import { body, jml } from "@/lib/jml/route";
import { activationSchema } from "@/lib/validations/jml/joiner";

/** Every blocker at once (Onboarding previewActivation). */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await previewActivation(actor, params.id!)))),
  { id: "jml-joiners-read", limit: 120, windowMs: 60_000 },
);

/** Activate onboarding: owner, template, tasks, EMP code, ONB reference — atomically. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      created(await activateJoiner(actor, params.id!, await body(req, activationSchema))),
    ),
  ),
  { id: "jml-joiners-activate", limit: 20, windowMs: 60_000 },
);
