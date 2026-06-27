import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { withManagerAuth, withRateLimit } from "@/lib/api-helpers";
import { err } from "@/lib/api-response";
import { getResultById } from "@/lib/services/result";
import { ResultDocument } from "@/lib/pdf/ResultDocument";

// GET /api/results/[id]/pdf — id = RESULT id. Streams the branded result PDF
// (UI-SPEC D.7 §8). withManagerAuth + orgId scoping (getResultById is tenant-scoped,
// so a wrong-tenant id is a 404, never a cross-tenant disclosure); rate limited
// OUTSIDE the auth wrapper (rendering is CPU work). A not-yet-computed result is a
// 404 here — the UI only shows the Export button once a result exists.
export const GET = withRateLimit(
  withManagerAuth(async (_request: NextRequest, { params, session }) => {
    const orgId = session.user.orgId;
    if (!orgId) return err("No organization context", 400);
    const { id } = await params;

    const view = await getResultById(orgId, id);
    if (!view) return err("Result not found", 404);

    const buffer = await renderToBuffer(ResultDocument({ view }));
    // RFC 6266 dual-parameter filename (mirrors lib/export.ts): an ASCII-only
    // `filename` (Arabic-only names collapse to a generic slug, never `_`) PLUS a
    // UTF-8 `filename*` that carries the real name — browsers prefer the latter, so
    // an Arabic-script candidate name/email is preserved instead of falling back.
    const rawName = (view.candidateName || view.candidateEmail).trim();
    const ascii =
      rawName.replace(/[\r\n";\\]/g, "").replace(/[^\x20-\x7E]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") ||
      "candidate";
    const filename = `rihal-result-${ascii}.pdf`;
    const encoded = encodeURIComponent(`rihal-result-${rawName}.pdf`);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, no-store",
      },
    });
  }),
  { id: "result-pdf", limit: 20, windowMs: 60_000 }
);
