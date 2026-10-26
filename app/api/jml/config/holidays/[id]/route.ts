import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { removeHoliday } from "@/lib/jml/config";
import { jml, requireGroup } from "@/lib/jml/route";

export const DELETE = withRateLimit(
  withAuth(
    jml(async ({ params, actor }) => {
      requireGroup(actor, "jml.configure");
      await removeHoliday(params.id!);
      return ok({ removed: true });
    }),
  ),
  { id: "jml-holidays-write", limit: 30, windowMs: 60_000 },
);
