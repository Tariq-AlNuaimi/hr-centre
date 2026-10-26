import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { canFor } from "@/lib/jml/access";
import { discardDraft } from "@/lib/jml/join/draft";
import { updateJoiner } from "@/lib/jml/join/update";
import { joinerSubject, loadJoinerRow, serializeJoiner } from "@/lib/jml/join/joiner-data";
import { JmlError } from "@/lib/jml/errors";
import { body, jml } from "@/lib/jml/route";
import { updateJoinerSchema } from "@/lib/validations/jml/joiner";

/** One joiner (salary only with people.viewSalary for that person). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ params, actor }) => {
      const row = await loadJoinerRow(params.id!);
      if (!canFor(actor, "jml.view", joinerSubject(row.employee))) {
        throw new JmlError("Joiner not found", 404);
      }
      return ok(serializeJoiner(row, actor));
    }),
  ),
  { id: "jml-joiners-read", limit: 120, windowMs: 60_000 },
);

export const PATCH = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) =>
      ok(await updateJoiner(actor, params.id!, await body(req, updateJoinerSchema))),
    ),
  ),
  { id: "jml-joiners-write", limit: 30, windowMs: 60_000 },
);

/** Discard a draft (soft delete — restorable from the recycling bin). */
export const DELETE = withRateLimit(
  withAuth(jml(async ({ params, actor }) => ok(await discardDraft(actor, params.id!)))),
  { id: "jml-joiners-write", limit: 30, windowMs: 60_000 },
);
