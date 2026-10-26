import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, ok } from "@/lib/api-response";
import { createContractType, listContractTypes } from "@/lib/jml/config";
import { body, jml, query, requireAnywhere, requireGroup } from "@/lib/jml/route";
import { contractTypeCreateSchema } from "@/lib/validations/jml/config";

/** HR's approved contract types (Onboarding §7.4 — activation is blocked until one exists). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireAnywhere(actor, "jml.view");
      const { includeInactive } = query(
        req,
        z.object({ includeInactive: z.enum(["true", "false"]).default("false") }),
      );
      return ok(await listContractTypes(includeInactive === "true"));
    }),
  ),
  { id: "jml-contract-types-read", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      return created(await createContractType(await body(req, contractTypeCreateSchema)));
    }),
  ),
  { id: "jml-contract-types-write", limit: 30, windowMs: 60_000 },
);
