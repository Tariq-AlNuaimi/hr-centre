import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, notFound, ok } from "@/lib/api-response";
import { addNeedNote, loadNeed, needThread } from "@/lib/hiring/planning";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { createNeedNoteSchema } from "@/lib/validations/hiring/planning";

/** The requirement-challenge thread (≤50 notes, oldest first). */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const need = await loadNeed(actor, id, "hiring.view");
      if (!need) return notFound("Department need");
      return ok(await needThread(need));
    }),
  ),
  { id: "hiring-planning-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const { id } = await params;
      const need = await loadNeed(actor, id, "hiring.manage");
      if (!need) return notFound("Department need");
      const body = await parseBody(req, createNeedNoteSchema);
      if ("response" in body) return body.response;
      return created(await addNeedNote(actor, need, body.data.body));
    }),
  ),
  { id: "hiring-planning-write", limit: 60, windowMs: 60_000 },
);
