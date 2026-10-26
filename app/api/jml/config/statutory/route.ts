import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { createStatutory, listStatutory } from "@/lib/jml/config";
import { body, jml, query, requireAnywhere, requireGroup } from "@/lib/jml/route";
import { statutoryCreateSchema } from "@/lib/validations/jml/config";

/** Statutory parameters (Offboarding US16): effective-dated, created unverified. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      return ok(
        await listStatutory(query(req, z.object({ key: z.string().max(80).optional() })).key),
      );
    }),
  ),
  { id: "jml-statutory-read", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return created(await createStatutory(await body(req, statutoryCreateSchema)));
    }),
  ),
  { id: "jml-statutory-write", limit: 30, windowMs: 60_000 },
);
