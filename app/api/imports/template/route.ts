import { NextResponse } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden } from "@/lib/api-response";
import { resolveActor } from "@/lib/pms/actor";
import { buildImportTemplate, xlsxDownloadHeaders } from "@/lib/pms/export/xlsx";

/**
 * The blank employee-import template — spec §3.3.
 *
 * Generated from `IMPORT_COLUMNS` rather than stored as a checked-in file, so
 * the headers HR downloads can never drift from the ones the loader actually
 * recognises. (A contract test round-trips the two: tests/contracts/pms-import.)
 *
 * Contains no employee data — it is a header row plus two clearly-labelled
 * example rows — but it is still gated to HR, because the column set is the
 * shape of the org's personnel record and there is no reason for it to be
 * generally readable.
 */
export const GET = withRateLimit(
  withAuth(async (_request, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.previewImport) return forbidden();

    const buffer = await buildImportTemplate();

    return new NextResponse(new Uint8Array(buffer), {
      headers: xlsxDownloadHeaders("employee-import-template.xlsx"),
    });
  }),
  { id: "pms-import-template", limit: 30, windowMs: 60_000 },
);
