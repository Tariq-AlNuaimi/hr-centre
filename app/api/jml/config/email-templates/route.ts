import { z } from "zod";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { isEmailEnabled } from "@/lib/email";
import { JmlError } from "@/lib/jml/errors";
import { jml, query, requireGroup } from "@/lib/jml/route";
import {
  SAMPLE_CONTEXT,
  contextForCase,
  missingVariables,
  render,
} from "@/lib/jml/email/templates";
import { resolveTemplate, resolveTemplates } from "@/lib/jml/email/overrides";

const previewSchema = z.object({
  type: z.string().max(64).optional(),
  caseId: z.string().max(64).optional(),
});

/** §11.2's templates as administered, or one rendered preview with any missing variables. */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.configure");
      const q = query(req, previewSchema);
      if (!q.type)
        return ok({ emailEnabled: isEmailEnabled(), templates: await resolveTemplates() });
      const template = await resolveTemplate(q.type);
      if (!template) throw new JmlError("Unknown email type", 404);
      const context = q.caseId ? await contextForCase(q.caseId) : SAMPLE_CONTEXT;
      if (!context) throw new JmlError("Case not found", 404);
      return ok({
        type: template.type,
        subject: render(template.subject, context),
        body: render(template.body, context),
        missing: [
          ...new Set([
            ...missingVariables(template.subject, context),
            ...missingVariables(template.body, context),
          ]),
        ],
      });
    }),
  ),
  { id: "jml-email-templates-read", limit: 120, windowMs: 60_000 },
);
