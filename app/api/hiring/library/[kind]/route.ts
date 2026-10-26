import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, forbidden, notFound, ok } from "@/lib/api-response";
import {
  canReadLibrary,
  createLibraryItem,
  listLibrary,
  seesLibraryPay,
} from "@/lib/hiring/library";
import { hiringRoute, parseBody, parseQuery } from "@/lib/hiring/route";
import { LIBRARY_SCHEMAS, libraryKind } from "@/lib/validations/hiring/library-schemas";

/** Knowledge base list (≤500) / create. `kind` ∈ competencies, grades, jd-templates, questions. */
export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const kind = libraryKind((await params).kind);
      if (!kind) return notFound("Library");
      if (!canReadLibrary(actor)) return forbidden();
      const q = parseQuery(req, z.object({ search: z.string().trim().max(100).optional() }));
      if ("response" in q) return q.response;
      return ok(await listLibrary(kind, q.data.search, seesLibraryPay(actor)));
    }),
  ),
  { id: "hiring-library-read", limit: 240, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const kind = libraryKind((await params).kind);
      if (!kind) return notFound("Library");
      const body = await parseBody(req, LIBRARY_SCHEMAS[kind]);
      if ("response" in body) return body.response;
      const data = { ...(body.data as Record<string, unknown>) };
      if (kind === "grades" && !seesLibraryPay(actor)) {
        delete data.minSalary;
        delete data.maxSalary;
      }
      return created(await createLibraryItem(actor, kind, data));
    }),
  ),
  { id: "hiring-library-write", limit: 60, windowMs: 60_000 },
);
