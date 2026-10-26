import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import {
  documentUrl,
  loadDocument,
  removeDocument,
  reviewDocument,
} from "@/lib/hiring/candidate-files";
import { loadCandidate, seesCandidateComp } from "@/lib/hiring/candidates";
import type { HiringActor } from "@/lib/hiring/access";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { reviewDocumentSchema } from "@/lib/validations/hiring/candidate";

export const dynamic = "force-dynamic";

/**
 * One piece of package evidence. Payslips are Restricted: opening, reviewing
 * or removing one needs comp rights on the candidate's requisition; anyone
 * else gets 404 (no confirmation the document exists).
 */
async function loadForComp(actor: HiringActor, id: string, docId: string) {
  const l = await loadCandidate(actor, id, "hiring.manage");
  if (!l || !seesCandidateComp(actor, l)) return null;
  return loadDocument(l, docId);
}

export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id, docId } = await params;
      const doc = await loadForComp(actor, id, docId);
      const url = doc ? await documentUrl(doc) : null;
      if (!url) return notFound("Document");
      const res = NextResponse.redirect(url, 302);
      res.headers.set("Cache-Control", "no-store");
      return res;
    }),
  ),
  { id: "hiring-candidate-read", limit: 240, windowMs: 60_000 },
);

export const PATCH = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id, docId } = await params;
      const doc = await loadForComp(actor, id, docId);
      if (!doc) return notFound("Document");
      const body = await parseBody(req, reviewDocumentSchema);
      if ("response" in body) return body.response;
      await reviewDocument(actor, doc, body.data);
      return ok({ id: docId });
    }),
  ),
  { id: "hiring-candidates-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id, docId } = await params;
      const doc = await loadForComp(actor, id, docId);
      if (!doc) return notFound("Document");
      await removeDocument(doc);
      return ok({ id: docId });
    }),
  ),
  { id: "hiring-candidates-write", limit: 60, windowMs: 60_000 },
);
