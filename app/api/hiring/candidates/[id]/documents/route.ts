import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, ok } from "@/lib/api-response";
import { listDocuments, uploadDocument } from "@/lib/hiring/candidate-files";
import { loadCandidate } from "@/lib/hiring/candidates";
import { hiringRoute } from "@/lib/hiring/route";
import { validationError } from "@/lib/org/http";
import { uploadDocumentFieldsSchema } from "@/lib/validations/hiring/candidate";

export const dynamic = "force-dynamic";

/** Package evidence: listed for HR (amounts + notes for comp readers only); uploaded as multipart. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l) return notFound("Candidate");
      return ok(await listDocuments(actor, l));
    }),
  ),
  { id: "hiring-candidate-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l) return notFound("Candidate");
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return err("No file provided.");
      const fields = uploadDocumentFieldsSchema.safeParse({
        kind: form?.get("kind"),
        label: form?.get("label"),
        periodMonth: form?.get("periodMonth") || null,
        statedAmount: form?.get("statedAmount") || null,
        fromCandidate: form?.get("fromCandidate") || undefined,
      });
      if (!fields.success) return validationError(fields.error);
      return created(await uploadDocument(actor, l, file, fields.data));
    }),
  ),
  { id: "hiring-upload", limit: 20, windowMs: 60_000 },
);
