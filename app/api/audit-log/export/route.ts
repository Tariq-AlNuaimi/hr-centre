import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth, withRateLimit } from "@/lib/api-helpers";
import { toExcel, excelDownloadHeaders, type ExportColumn } from "@/lib/export";
import {
  listAuditLogForExport,
  AUDIT_ACTIONS,
  type AuditRow,
  type AuditActionValue,
} from "@/lib/services/audit";

// GET /api/audit-log/export — the current filtered audit window as a branded .xlsx
// (UI-SPEC D.10, the ISO/PDPL evidence surface). withAdminAuth + orgId-scoped;
// rate-limited OUTSIDE (Excel rendering is CPU work). Restricted values were scrubbed
// at write time, so no secret reaches the sheet; the columns are non-Restricted names
// (the no-restricted-export-column rule enforces this).
const COLUMNS: ExportColumn<AuditRow>[] = [
  { header: "Timestamp", key: "timestamp", format: (v) => (v as Date).toISOString() },
  { header: "Action", key: "action" },
  { header: "Entity type", key: "entityType" },
  { header: "Entity ID", key: "entityId" },
  { header: "Actor", key: "actorName", format: (_v, row) => row.actorName ?? row.actorEmail ?? "system" },
  { header: "Actor email", key: "actorEmail", format: (v) => (v as string | null) ?? "" },
  { header: "Changed fields", key: "changedFields", format: (v) => ((v as string[]) ?? []).join(", ") },
];

export const GET = withRateLimit(
  withAdminAuth(async (request: NextRequest, { session }) => {
    const orgId = session.user.orgId;
    const sp = request.nextUrl.searchParams;
    const actionParam = sp.get("action");
    const action = AUDIT_ACTIONS.includes(actionParam as AuditActionValue)
      ? (actionParam as AuditActionValue)
      : undefined;
    const entityType = sp.get("entityType") || undefined;

    const rows = await listAuditLogForExport(orgId, { action, entityType });
    const xlsx = await toExcel(rows, COLUMNS);
    return new NextResponse(new Uint8Array(xlsx), { headers: excelDownloadHeaders("audit-log.xlsx") });
  }),
  { id: "audit-export", limit: 10, windowMs: 60_000 }
);
