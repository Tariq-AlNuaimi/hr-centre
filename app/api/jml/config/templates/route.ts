import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { parsePagination } from "@/lib/pagination";
import { createTemplate, listTemplates } from "@/lib/jml/engine/templates";
import { body, jml, query, requireGroup } from "@/lib/jml/route";
import { CASE_TYPES, createTemplateSchema } from "@/lib/validations/jml/template";

const filterSchema = z.object({
  caseType: z.enum(CASE_TYPES).optional(),
  active: z.enum(["true", "false"]).optional(),
  search: z.string().trim().max(120).optional(),
  allVersions: z.enum(["true", "false"]).optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

/** Checklist templates — one model for joiners, movers and leavers. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      const f = query(req, filterSchema);
      return ok(
        await listTemplates(
          {
            caseType: f.caseType,
            active: f.active === undefined ? undefined : f.active === "true",
            search: f.search,
            allVersions: f.allVersions === "true",
          },
          parsePagination(req.nextUrl.searchParams),
        ),
      );
    }),
  ),
  { id: "jml-templates-read", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return created(await createTemplate(await body(req, createTemplateSchema)));
    }),
  ),
  { id: "jml-templates-write", limit: 30, windowMs: 60_000 },
);
