import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { NextResponse } from "next/server";
import { docxHeaders } from "@/lib/jml/docs/engine";
import { templateFile } from "@/lib/jml/docs/templates";
import { jml, requireAnywhere } from "@/lib/jml/route";

/** Download a template to edit it in Word. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ params, actor }) => {
      requireAnywhere(actor, "jml.configure");
      const f = await templateFile(params.templateId!);
      return new NextResponse(new Uint8Array(f.buffer), { headers: docxHeaders(f.filename) });
    }),
  ),
  { id: "jml-config-read", limit: 60, windowMs: 60_000 },
);
