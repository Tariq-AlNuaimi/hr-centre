import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, notFound, ok } from "@/lib/api-response";
import { importCandidates } from "@/lib/hiring/candidate-bulk";
import { loadRequisition } from "@/lib/hiring/requisitions";
import { hiringRoute } from "@/lib/hiring/route";
import { importCandidatesSchema } from "@/lib/validations/hiring/candidate";

/** A spreadsheet of candidates for one requisition (multipart: requisitionId + file). */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { actor }) => {
      const form = await req.formData().catch(() => null);
      const parsed = importCandidatesSchema.safeParse({
        requisitionId: form?.get("requisitionId"),
      });
      if (!parsed.success) return err("Choose the requisition to import into.");
      const file = form?.get("file");
      if (!(file instanceof File)) return err("Choose an Excel file to import.");
      const l = await loadRequisition(actor, parsed.data.requisitionId, "hiring.manage");
      if (!l) return notFound("Requisition");
      return ok(await importCandidates(actor, l, Buffer.from(await file.arrayBuffer())));
    }),
  ),
  { id: "hiring-upload", limit: 20, windowMs: 60_000 },
);
