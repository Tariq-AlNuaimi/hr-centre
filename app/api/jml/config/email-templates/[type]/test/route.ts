import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { isEmailEnabled, sendEmail } from "@/lib/email";
import { JmlError } from "@/lib/jml/errors";
import { body, jml, requireGroup } from "@/lib/jml/route";
import {
  SAMPLE_CONTEXT,
  contextForCase,
  missingVariables,
  render,
} from "@/lib/jml/email/templates";
import { resolveTemplate } from "@/lib/jml/email/overrides";
import { testEmailSchema } from "@/lib/validations/jml/config";

/**
 * Send one rendered template to an administrator's address, subject prefixed
 * "[TEST]". Honest when SMTP is off: `{ sent: false, reason: "email-disabled" }`.
 */
export const POST = withRateLimit(
  withAuth(
    jml(async ({ req, params, actor }) => {
      requireGroup(actor, "jml.configure");
      const input = await body(req, testEmailSchema);
      const template = await resolveTemplate(params.type!);
      if (!template) throw new JmlError("Unknown email type", 404);
      const context = input.caseId ? await contextForCase(input.caseId) : SAMPLE_CONTEXT;
      if (!context) throw new JmlError("Case not found", 404);
      const subject = `[TEST] ${render(template.subject, context)}`;
      const missing = missingVariables(template.body, context);
      if (!isEmailEnabled()) return ok({ sent: false, reason: "email-disabled", subject, missing });
      const text = render(template.body, context);
      const result = await sendEmail({ to: input.recipient, subject, text });
      return ok({ sent: result.sent, subject, missing });
    }),
  ),
  { id: "jml-email-test", limit: 5, windowMs: 60_000 },
);
