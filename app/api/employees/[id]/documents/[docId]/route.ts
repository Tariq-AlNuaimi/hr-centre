import { NextResponse, type NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { documentAccess } from "@/lib/core/documents/access";
import {
  documentReadUrl,
  findEmployeeDocument,
  removeEmployeeDocument,
} from "@/lib/core/documents/store";

export const dynamic = "force-dynamic";

/**
 * One core document (ADR-098). Opening it is a redirect to a short-lived signed
 * URL issued AFTER the checks; a document the viewer may not see is a 404.
 */
async function load(session: Parameters<typeof documentAccess>[0], id: string, docId: string) {
  const access = await documentAccess(session, id);
  if (!access) return null;
  const doc = await findEmployeeDocument(id, docId);
  if (!doc || (doc.restricted && !access.restricted)) return null;
  return { access, doc };
}

export const GET = withRateLimit(
  withAuth(async (_req: NextRequest, { params, session }) => {
    const { id, docId } = await params;
    const l = await load(session, String(id), String(docId));
    if (!l) return notFound("Document");
    const res = NextResponse.redirect(await documentReadUrl(l.doc), 302);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }),
  { id: "employee-documents-read", limit: 240, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(async (_req: NextRequest, { params, session }) => {
    const { id, docId } = await params;
    const l = await load(session, String(id), String(docId));
    if (!l) return notFound("Document");
    if (!l.access.edit) return err("You can't remove documents from this person's record.", 403);
    await removeEmployeeDocument(l.doc.id);
    return ok({ removed: true });
  }),
  { id: "employee-documents-write", limit: 30, windowMs: 60_000 },
);
