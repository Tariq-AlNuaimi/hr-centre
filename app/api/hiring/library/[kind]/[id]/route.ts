import type { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, notFound, ok } from "@/lib/api-response";
import {
  canReadLibrary,
  deleteLibraryItem,
  getLibraryItem,
  seesLibraryPay,
  updateLibraryItem,
} from "@/lib/hiring/library";
import { hiringRoute, parseBody } from "@/lib/hiring/route";
import { LIBRARY_SCHEMAS, libraryKind } from "@/lib/validations/hiring/library-schemas";

export const GET = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const p = await params;
      const kind = libraryKind(p.kind);
      if (!kind) return notFound("Library");
      if (!canReadLibrary(actor)) return forbidden();
      const item = await getLibraryItem(kind, p.id, seesLibraryPay(actor));
      return item ? ok(item) : notFound("Library entry");
    }),
  ),
  { id: "hiring-library-read", limit: 240, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    hiringRoute(async (req, { params, actor }) => {
      const p = await params;
      const kind = libraryKind(p.kind);
      if (!kind) return notFound("Library");
      const schema = LIBRARY_SCHEMAS[kind] as z.ZodObject<z.ZodRawShape>;
      const partial = "partial" in schema ? schema.partial() : schema;
      const body = await parseBody(req, partial);
      if ("response" in body) return body.response;
      const data = { ...(body.data as Record<string, unknown>) };
      if (kind === "grades" && !seesLibraryPay(actor)) {
        delete data.minSalary;
        delete data.maxSalary;
      }
      const item = await updateLibraryItem(actor, kind, p.id, data);
      return item ? ok(item) : notFound("Library entry");
    }),
  ),
  { id: "hiring-library-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(
    hiringRoute(async (_req, { params, actor }) => {
      const p = await params;
      const kind = libraryKind(p.kind);
      if (!kind) return notFound("Library");
      return (await deleteLibraryItem(actor, kind, p.id))
        ? ok({ deleted: true })
        : notFound("Library entry");
    }),
  ),
  { id: "hiring-library-write", limit: 60, windowMs: 60_000 },
);
