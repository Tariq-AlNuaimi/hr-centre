import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import {
  CoverageForbidden,
  coverageEditor,
  coverageView,
  createCoverage,
} from "@/lib/core/hr-coverage/admin";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { hrCoverageSchema } from "@/lib/validations/core/hr-coverage";

/**
 * Admin › Settings › HR coverage (ADR-102): who covers which unit, for HR
 * tickets and for joiner / mover / leaver cases. `tickets.configure` or
 * `jml.configure` (group-wide) to read; each half of a row needs its own.
 */
export const GET = withRateLimit(
  withAuth(async (_req: NextRequest, { session }) => {
    const editor = await coverageEditor(session.user.id);
    if (!editor.tickets && !editor.jml) return forbidden();
    return ok(await coverageView(editor));
  }),
  { id: "hr-coverage-read", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(async (req: NextRequest, { session }) => {
    const editor = await coverageEditor(session.user.id);
    if (!editor.tickets && !editor.jml) return forbidden();
    const body = await readJsonBody(req);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = hrCoverageSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    try {
      return created(await createCoverage(editor, parsed.data));
    } catch (e) {
      if (e instanceof CoverageForbidden) return forbidden();
      return ruleErrorResponse(e);
    }
  }),
  { id: "hr-coverage-write", limit: 60, windowMs: 60_000 },
);
