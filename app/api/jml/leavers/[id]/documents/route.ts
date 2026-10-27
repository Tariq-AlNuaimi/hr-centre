import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { NextResponse } from "next/server";
import { ok } from "@/lib/api-response";
import { docxHeaders } from "@/lib/jml/docs/engine";
import { generateDocument, listCaseDocuments } from "@/lib/jml/docs/generate";
import { body, jml } from "@/lib/jml/route";
import { generateDocumentSchema } from "@/lib/validations/jml/leave";

/** Documents generated on this exit, and the active template per type. */
export const GET = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await listCaseDocuments(actor, params.id!)))),
  { id: "jml-leavers-read", limit: 120, windowMs: 60_000 },
);

/** Generate a .docx — streamed, never stored (BR-OFF-027). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const r = await generateDocument(actor, params.id!, await body(req, generateDocumentSchema));
      return new NextResponse(new Uint8Array(r.buffer), {
        headers: {
          ...docxHeaders(r.filename),
          "X-Generation-Id": r.generationId,
          "X-Template-Version": String(r.templateVersion),
        },
      });
    }),
  ),
  { id: "jml-documents-generate", limit: 30, windowMs: 60_000 },
);
