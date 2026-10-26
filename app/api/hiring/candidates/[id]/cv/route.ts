import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { can } from "@/lib/hiring/access";
import { cvUrl, uploadCv } from "@/lib/hiring/candidate-files";
import { loadCandidate } from "@/lib/hiring/candidates";
import { hiringRoute } from "@/lib/hiring/route";

export const dynamic = "force-dynamic";

/**
 * The CV (Restricted PII): HR with PII rights only. GET answers a redirect to a
 * five-minute signed URL — the store is private, the signature is the last
 * step of an authorised read. A reader without PII rights gets 404.
 */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l || !can(actor, "hiring.viewPii", l.subject)) return notFound("CV");
      const url = await cvUrl(l);
      if (!url) return notFound("CV");
      const res = NextResponse.redirect(url, 302);
      res.headers.set("Cache-Control", "no-store");
      return res;
    }),
  ),
  { id: "hiring-candidate-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l || !can(actor, "hiring.viewPii", l.subject)) return notFound("Candidate");
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return err("No file provided.");
      await uploadCv(l, file);
      return ok({ id, cvFileName: file.name });
    }),
  ),
  { id: "hiring-upload", limit: 20, windowMs: 60_000 },
);
