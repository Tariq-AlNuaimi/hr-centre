import type { z } from "zod";
import { err } from "@/lib/api-response";
import { IdDocumentKeyError } from "@/lib/people/id-documents";
import { OrgRuleError } from "./rules";

/**
 * The two translations every org/people/rbac route needs, written once:
 * a zod failure becomes "field: why" (AC-F2.1 — "validation messages say which
 * field and why"), and a service refusal becomes its own status and sentence.
 * Anything else is a bug and is rethrown so it reaches the error boundary
 * instead of being dressed up as a 400.
 */

export function validationError(error: z.ZodError) {
  return err(
    error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join(", "),
  );
}

export function ruleErrorResponse(e: unknown) {
  if (e instanceof OrgRuleError) return err(e.message, e.status);
  // Blueprint worst path: a missing ID key fails the write closed, with a
  // sentence, and nothing is saved.
  if (e instanceof IdDocumentKeyError) return err(e.message, 503);
  throw e;
}
