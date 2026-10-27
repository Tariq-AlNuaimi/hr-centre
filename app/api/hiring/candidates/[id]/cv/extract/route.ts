import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { notFound, ok } from "@/lib/api-response";
import { can } from "@/lib/hiring/access";
import { extractStoredCv } from "@/lib/hiring/ai/parse";
import { loadCandidate } from "@/lib/hiring/candidates";
import { hiringRoute } from "@/lib/hiring/route";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Extract the profile from the candidate's stored CV and keep it on the record (HR with PII rights). */
export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const { id } = await params;
      const l = await loadCandidate(actor, id, "hiring.manage");
      if (!l || !can(actor, "hiring.viewPii", l.subject)) return notFound("Candidate");
      return ok(await extractStoredCv(actor, l));
    }),
  ),
  { id: "hiring-ai-parse", limit: 10, windowMs: 60_000 },
);
