import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import {
  issuePreboardingLink,
  preboardingStatus,
  revokePreboardingLinks,
} from "@/lib/jml/preboarding/hr";
import { body, jml } from "@/lib/jml/route";

/**
 * P2-4 — the joiner's preboarding link, from the HR side. GET needs view access
 * to the case; issuing and revoking need `jml.manageJoiners` in scope (checked
 * by the service through `loadCaseFor`; out of scope is a 404).
 */

const issueSchema = z.object({ email: z.boolean().default(false) }).strict();

export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await preboardingStatus(actor, params.id!)))),
  { id: "jml-preboarding-read", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const input = await body(req, issueSchema);
      return ok(await issuePreboardingLink(actor, params.id!, input));
    }),
  ),
  { id: "jml-preboarding-issue", limit: 20, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await revokePreboardingLinks(actor, params.id!)))),
  { id: "jml-preboarding-issue", limit: 20, windowMs: 60_000 },
);
