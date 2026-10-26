import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { createPositionClassification, listPositionClassifications } from "@/lib/jml/config";
import { body, jml, query, requireAnywhere, requireGroup } from "@/lib/jml/route";
import { classificationCreateSchema } from "@/lib/validations/jml/config";

export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      const { includeInactive } = query(
        req,
        z.object({ includeInactive: z.enum(["true", "false"]).default("false") }),
      );
      return ok(await listPositionClassifications(includeInactive === "true"));
    }),
  ),
  { id: "jml-classifications-read", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return created(
        await createPositionClassification(await body(req, classificationCreateSchema)),
      );
    }),
  ),
  { id: "jml-classifications-write", limit: 30, windowMs: 60_000 },
);
