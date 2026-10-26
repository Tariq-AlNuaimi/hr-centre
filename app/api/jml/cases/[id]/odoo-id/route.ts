import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { loadCaseFor, MANAGE_PERMISSION } from "@/lib/jml/access";
import { JmlError } from "@/lib/jml/errors";
import { body, jml } from "@/lib/jml/route";
import { recordOdooId } from "@/lib/people/odoo-id";
import { prisma } from "@/lib/prisma";
import { odooIdSchema } from "@/lib/validations/jml/case";

/**
 * Record the real Odoo id once HR has created the Odoo profile (ADR-075): one
 * audited operation re-keys everything bound to the provisional id.
 */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      const head = await prisma.jmlCase.findUnique({
        where: { id: params.id! },
        select: { caseType: true },
      });
      if (!head) throw new JmlError("Case not found", 404);
      const kase = await loadCaseFor(actor, params.id!, MANAGE_PERMISSION[head.caseType]);
      const input = await body(req, odooIdSchema);
      await recordOdooId(kase.employeeId, input.odooId);
      return ok({ odooId: input.odooId });
    }),
  ),
  { id: "jml-case-actions", limit: 30, windowMs: 60_000 },
);
