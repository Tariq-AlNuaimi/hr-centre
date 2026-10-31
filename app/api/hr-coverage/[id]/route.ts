import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import {
  CoverageForbidden,
  coverageEditor,
  removeCoverage,
  updateCoverage,
} from "@/lib/core/hr-coverage/admin";
import { ruleErrorResponse, validationError } from "@/lib/org/http";
import { hrCoverageSchema } from "@/lib/validations/core/hr-coverage";

/** One coverage row (ADR-102). Each half needs its own permission; group-wide only. */
export const PATCH = withRateLimit(
  withAuth(async (req: NextRequest, { session, params }) => {
    const editor = await coverageEditor(session.user.id);
    if (!editor.tickets && !editor.jml) return forbidden();
    const id = String((await params).id ?? "");
    const body = await readJsonBody(req);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = hrCoverageSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    try {
      return ok(await updateCoverage(editor, id, parsed.data));
    } catch (e) {
      if (e instanceof CoverageForbidden) return forbidden();
      return ruleErrorResponse(e);
    }
  }),
  { id: "hr-coverage-write", limit: 60, windowMs: 60_000 },
);

export const DELETE = withRateLimit(
  withAuth(async (_req: NextRequest, { session, params }) => {
    const editor = await coverageEditor(session.user.id);
    if (!editor.tickets && !editor.jml) return forbidden();
    const id = String((await params).id ?? "");
    try {
      await removeCoverage(editor, id);
      return ok({ id, deleted: true });
    } catch (e) {
      if (e instanceof CoverageForbidden) return forbidden();
      return ruleErrorResponse(e);
    }
  }),
  { id: "hr-coverage-write", limit: 60, windowMs: 60_000 },
);
