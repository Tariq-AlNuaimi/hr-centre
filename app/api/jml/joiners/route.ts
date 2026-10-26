import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { createJoinerDraft } from "@/lib/jml/join/draft";
import { listJoiners } from "@/lib/jml/join/list";
import { body, jml, query, requireAnywhere } from "@/lib/jml/route";
import { draftJoinerSchema, joinerListSchema } from "@/lib/validations/jml/joiner";

/** Joiners (Onboarding /api/new-hires): drafts and activated, scope-filtered, no salary. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      const page = parsePagination(req.nextUrl.searchParams);
      const { rows, total } = await listJoiners(actor, query(req, joinerListSchema), page);
      return ok(paginatedResponse(rows, total, page));
    }),
  ),
  { id: "jml-joiners-read", limit: 120, windowMs: 60_000 },
);

/** Save a draft — creates the PRE_JOINER employee and a DRAFT joiner case. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) =>
      created(await createJoinerDraft(actor, await body(req, draftJoinerSchema))),
    ),
  ),
  { id: "jml-joiners-write", limit: 30, windowMs: 60_000 },
);
