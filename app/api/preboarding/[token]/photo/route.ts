import { err, ok } from "@/lib/api-response";
import { withRateLimit } from "@/lib/api-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { tokenScopedRequest, withPrivateHeaders } from "@/lib/jml/preboarding/http";
import { JmlError } from "@/lib/jml/errors";
import { resolvePreboarding, uploadPreboardingPhoto } from "@/lib/jml/preboarding/joiner";
import { MAX_PHOTO_BYTES } from "@/lib/jml/preboarding/rules";
import { preboardingTokenSchema } from "@/lib/validations/jml/preboarding";

/**
 * P2-4 — the joiner's passport-size picture (T08). PUBLIC by design (ADR-093):
 * the token is the authorisation for one case. JPEG/PNG, under 2 MB, private
 * Blob storage; 503 when storage is not configured (the form says so first).
 */

async function postPhoto(req: Request, ctx: { params: Promise<Record<string, string>> }) {
  const raw = preboardingTokenSchema.safeParse((await ctx.params).token);
  if (!raw.success) return withPrivateHeaders(err("Not found.", 404));

  const limit = await rateLimit(tokenScopedRequest(raw.data, "preboarding-photo"), {
    id: "jml-preboarding-photo",
    limit: 5,
    windowMs: 60_000,
  });
  if (!limit.ok) return withPrivateHeaders(err("Too many requests", 429));

  // Refuse an oversized body before reading it into memory.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_PHOTO_BYTES + 64 * 1024) {
    return withPrivateHeaders(err("The picture must be smaller than 2 MB.", 422));
  }

  const grant = await resolvePreboarding(raw.data);
  if (!grant) return withPrivateHeaders(err("Not found.", 404));

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return withPrivateHeaders(err("Choose a picture to upload.", 400));

  try {
    return withPrivateHeaders(ok(await uploadPreboardingPhoto(grant.caseId, file)));
  } catch (e) {
    if (e instanceof JmlError) return withPrivateHeaders(err(e.message, e.status));
    throw e;
  }
}

export const POST = withRateLimit(postPhoto, {
  id: "jml-preboarding-photo-ip",
  limit: 30,
  windowMs: 60_000,
});
