import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { listCases } from "@/lib/jml/engine/case-read";
import { jml, query, requireAnywhere } from "@/lib/jml/route";
import { caseListSchema } from "@/lib/validations/jml/case";

/** Cases of every type, scope-filtered; default live + completed. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      const page = parsePagination(req.nextUrl.searchParams);
      const { rows, total } = await listCases(actor, query(req, caseListSchema), page);
      return ok(paginatedResponse(rows, total, page));
    }),
  ),
  { id: "jml-cases-read", limit: 120, windowMs: 60_000 },
);
