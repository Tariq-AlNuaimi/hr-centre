import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { changeStartDate } from "@/lib/jml/join/actions";
import { body, jml } from "@/lib/jml/route";
import { startDateSchema } from "@/lib/validations/jml/case";

/** Move a joiner's planned start: tasks shift on the working calendar; IT, PRO and the line manager are told. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const input = await body(req, startDateSchema);
      return ok(await changeStartDate(actor, params.id!, input.plannedStartDate));
    }),
  ),
  { id: "jml-case-actions", limit: 30, windowMs: 60_000 },
);
