import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { listCaseEmails } from "@/lib/jml/engine/case-read";
import { sendWelcomeReview } from "@/lib/jml/join/actions";
import { body, jml } from "@/lib/jml/route";
import { sendWelcomeReviewSchema } from "@/lib/validations/jml/case";

/** The case's message log (no bodies, ever — §11.3). */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await listCaseEmails(actor, params.id!)))),
  { id: "jml-cases-read", limit: 120, windowMs: 60_000 },
);

/** §11.2 row 10: HR reviews and sends the welcome email — queued from the case. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const input = await body(req, sendWelcomeReviewSchema);
      return created(await sendWelcomeReview(actor, params.id!, input.recipient));
    }),
  ),
  { id: "jml-case-emails", limit: 10, windowMs: 60_000 },
);
