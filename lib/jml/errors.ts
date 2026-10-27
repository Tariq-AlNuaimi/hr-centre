import type { NextResponse } from "next/server";
import type { z } from "zod";
import { err } from "@/lib/api-response";
import { OrgRuleError } from "@/lib/org/rules";
import { IdDocumentKeyError } from "@/lib/people/id-documents";
import { EmployeeCodeError } from "@/lib/people/employee-code";
import { StatutoryParameterMissingError } from "@/lib/statutory/parameters";

/**
 * A JML refusal — a sentence a person can act on, with the HTTP status the
 * route returns (the sources' OnboardingError / err(message, status)).
 */
export class JmlError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 422 | 503 = 409,
  ) {
    super(message);
    this.name = "JmlError";
  }
}

/** A zod failure travelling as an exception (lib/jml/route.ts `body` / `query`). */
export class ValidationFailure extends Error {
  constructor(readonly error: z.ZodError) {
    super("validation");
    this.name = "ValidationFailure";
  }
}

/** "field: why" — every zod issue, joined (Onboarding/Offboarding both did this). */
function jmlValidationError(error: z.ZodError): NextResponse {
  return err(
    error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; "),
    422,
  );
}

/** Service refusals become their status and sentence; anything else is a bug and rethrows. */
export function jmlErrorResponse(e: unknown): NextResponse {
  if (e instanceof JmlError) return err(e.message, e.status);
  if (e instanceof ValidationFailure) return jmlValidationError(e.error);
  if (e instanceof OrgRuleError) return err(e.message, e.status);
  if (e instanceof EmployeeCodeError) return err(e.message, 409);
  if (e instanceof StatutoryParameterMissingError) return err(e.message, 422);
  if (e instanceof IdDocumentKeyError) return err(e.message, 503);
  throw e;
}
