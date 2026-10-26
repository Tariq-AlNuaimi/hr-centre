import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { loadCaseFor } from "@/lib/jml/access";
import { JmlError } from "@/lib/jml/errors";
import { retryEmail } from "@/lib/jml/email/queue";
import { jml } from "@/lib/jml/route";

/** AC-7.4 — retry a failed or stuck message: a NEW queued row linked to the original. */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ params, actor }) => {
      const row = await prisma.jmlEmailLog.findUnique({
        where: { id: params.id! },
        select: { caseId: true },
      });
      if (!row?.caseId) throw new JmlError("Email not found", 404);
      await loadCaseFor(actor, row.caseId, "jml.workTasks");
      return created(await retryEmail(params.id!, actor.userId));
    }),
  ),
  { id: "jml-email-retry", limit: 30, windowMs: 60_000 },
);
