import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, type AuditActionValue } from "@/lib/validations/audit";

// Re-export the client-safe constants so server callers can keep importing from the
// service; the "use client" filter imports them from lib/validations/audit directly.
export { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES };
export type { AuditActionValue };

// Audit-log read service (UI-SPEC D.10, ARCHITECTURE §11) — the ISO/PDPL evidence
// surface. Tenant-scoped, paginated, filterable. Uses the standard `prisma` client:
// AuditLog has no deletedAt (not a soft-delete model), so the soft-delete extension
// injects nothing, and reads aren't re-audited. Restricted values were already
// scrubbed at WRITE time (SCRUB_FIELDS), so the `changes` keys shown carry no secrets.

const LIST_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  action: true,
  changes: true,
  timestamp: true,
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.AuditLogSelect;

export type AuditRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changedFields: string[];
  timestamp: Date;
  actorName: string | null;
  actorEmail: string | null;
};

export type AuditFilters = {
  action?: AuditActionValue;
  entityType?: string;
  userId?: string;
};

function buildWhere(orgId: string | null, filters: AuditFilters): Prisma.AuditLogWhereInput {
  // Strict orgId equality: system/bootstrap rows (orgId null) and other tenants are
  // both excluded (the same scoping the GET route applies).
  const where: Prisma.AuditLogWhereInput = { orgId };
  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.userId) where.userId = filters.userId;
  return where;
}

function changedFields(changes: Prisma.JsonValue): string[] {
  if (changes && typeof changes === "object" && !Array.isArray(changes)) {
    return Object.keys(changes);
  }
  return [];
}

/** Tenant-scoped, paginated, filterable audit list (the table view). */
export async function listAuditLog(
  orgId: string | null,
  filters: AuditFilters,
  page: { skip: number; take: number }
): Promise<{ data: AuditRow[]; total: number }> {
  const where = buildWhere(orgId, filters);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip: page.skip,
      take: page.take,
      orderBy: { timestamp: "desc" },
      select: LIST_SELECT,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      changedFields: changedFields(r.changes),
      timestamp: r.timestamp,
      actorName: r.user?.name ?? null,
      actorEmail: r.user?.email ?? null,
    })),
    total,
  };
}

// Bounded export ceiling — the audit trail can be large; an export is the current
// filtered window, capped, not the whole table (Scalable pillar).
export const AUDIT_EXPORT_CAP = 5000;

/** Tenant-scoped rows for the Excel export (bounded by AUDIT_EXPORT_CAP). */
export async function listAuditLogForExport(
  orgId: string | null,
  filters: AuditFilters
): Promise<AuditRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: buildWhere(orgId, filters),
    orderBy: { timestamp: "desc" },
    take: AUDIT_EXPORT_CAP,
    select: LIST_SELECT,
  });
  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    changedFields: changedFields(r.changes),
    timestamp: r.timestamp,
    actorName: r.user?.name ?? null,
    actorEmail: r.user?.email ?? null,
  }));
}
