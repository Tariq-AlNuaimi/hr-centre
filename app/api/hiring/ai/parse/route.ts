import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, ok } from "@/lib/api-response";
import { holdsAnywhere } from "@/lib/hiring/access";
import { parseDocument } from "@/lib/hiring/ai/parse";
import { hiringRoute } from "@/lib/hiring/route";
import { CV_MAX_BYTES, parseModeSchema } from "@/lib/validations/hiring/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Read a CV, JD or competency matrix into a form (Interview Hub `/api/parse-cv`,
 * `/api/parse-jd`). Nothing is stored: the form shows the result for HR to
 * review. HR with manage rights only; a CV additionally needs PII rights.
 */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      if (!holdsAnywhere(actor, "hiring.manage")) return forbidden();
      const form = await req.formData().catch(() => null);
      const mode = parseModeSchema.safeParse(form?.get("mode"));
      if (!mode.success) return err("Say what the document is: cv, jd or competencies.");
      if (mode.data === "cv" && !holdsAnywhere(actor, "hiring.viewPii")) return forbidden();
      const file = form?.get("file");
      if (!(file instanceof File)) return err("No file provided.");
      if (file.size === 0) return err("The file is empty.");
      if (file.size > CV_MAX_BYTES) return err("File too large (max 8 MB).");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = ok(await parseDocument(bytes, file.name, mode.data, actor.userId));
      res.headers.set("Cache-Control", "no-store");
      return res;
    }),
  ),
  { id: "hiring-ai-parse", limit: 10, windowMs: 60_000 },
);
