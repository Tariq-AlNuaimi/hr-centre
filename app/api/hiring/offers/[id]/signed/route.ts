import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { signedLetterUrl, uploadSignedLetter } from "@/lib/hiring/offer-acceptance";
import { loadOffer } from "@/lib/hiring/offers";
import { hiringRoute } from "@/lib/hiring/route";

export const dynamic = "force-dynamic";

/** The signed offer letter (private blob; a read is a five-minute signed redirect). Pay: comp readers only. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id, "manage");
      if (!l || !l.comp) return notFound("Signed letter");
      const url = await signedLetterUrl(l);
      if (!url) return notFound("Signed letter");
      const res = NextResponse.redirect(url, 302);
      res.headers.set("Cache-Control", "no-store");
      return res;
    }),
  ),
  { id: "hiring-offer-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadOffer(actor, id, "manage");
      if (!l || !l.comp) return notFound("Offer");
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return err("No file provided.");
      return ok(await uploadSignedLetter(l, file));
    }),
  ),
  { id: "hiring-upload", limit: 20, windowMs: 60_000 },
);
