import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { importHistoricalExits } from "@/lib/jml/leave/import";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { importExitsSchema } from "@/lib/validations/jml/report";

/** Historical exits from CSV: a dry run unless `commit` (§26.2). */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, actor, session }) => {
      requireGroup(actor, "jml.configure");
      const input = await body(req, importExitsSchema);
      return ok(
        await importHistoricalExits(input.csv, input.commit, {
          userId: session.user.id,
          email: session.user.email ?? null,
        }),
      );
    }),
  ),
  { id: "jml-import", limit: 10, windowMs: 60_000 },
);
