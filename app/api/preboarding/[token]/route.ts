import { err, ok, readJsonBody } from "@/lib/api-response";
import { withRateLimit } from "@/lib/api-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { tokenScopedRequest, withPrivateHeaders } from "@/lib/jml/preboarding/http";
import { resolvePreboarding, submitPreboarding } from "@/lib/jml/preboarding/joiner";
import { preboardingSubmitSchema, preboardingTokenSchema } from "@/lib/validations/jml/preboarding";

/**
 * P2-4 — the joiner's preboarding form submission. PUBLIC by design (operator
 * approved, ADR-093): the TOKEN in the path is the authorisation, for exactly
 * one joiner case, only while that case is an open onboarding of someone who
 * has not started. Hashed, expiring, revocable (ADR-090). Rate-limited per IP
 * (outer) and per token (inner); every failure is the same 404.
 */

async function postForm(req: Request, ctx: { params: Promise<Record<string, string>> }) {
  const raw = preboardingTokenSchema.safeParse((await ctx.params).token);
  if (!raw.success) return withPrivateHeaders(err("Not found.", 404));

  const limit = await rateLimit(tokenScopedRequest(raw.data, "preboarding"), {
    id: "jml-preboarding-write",
    limit: 10,
    windowMs: 60_000,
  });
  if (!limit.ok) return withPrivateHeaders(err("Too many requests", 429));

  const parsed = preboardingSubmitSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return withPrivateHeaders(err(parsed.error.issues[0]?.message ?? "Check the form.", 400));
  }

  const grant = await resolvePreboarding(raw.data);
  if (!grant) return withPrivateHeaders(err("Not found.", 404));

  return withPrivateHeaders(ok(await submitPreboarding(grant.caseId, parsed.data)));
}

export const POST = withRateLimit(postForm, {
  id: "jml-preboarding-write-ip",
  limit: 60,
  windowMs: 60_000,
});
