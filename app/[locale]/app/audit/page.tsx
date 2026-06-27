import { getTranslations, getFormatter } from "next-intl/server";
import { Download } from "lucide-react";
import { requireAdmin } from "@/lib/authz";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { listAuditLog, AUDIT_ACTIONS, type AuditActionValue } from "@/lib/services/audit";
import { AuditFilter } from "./AuditFilter";

// Audit log (UI-SPEC D.10, ARCHITECTURE §11) — admin only, the ISO/PDPL evidence
// surface. RSC read via the tenant-scoped service; filter is a client island; Excel
// export is a download link carrying the current filters. Paginated/bounded.
const ACTION_VARIANT: Record<string, "pass" | "outline" | "partial" | "below"> = {
  CREATE: "pass",
  UPDATE: "outline",
  RESTORE: "partial",
  DELETE: "below",
};

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; action?: string; entityType?: string }>;
}) {
  const { locale } = await params;
  const { page: pageParam, action: actionParam, entityType: entityParam } = await searchParams;
  const session = await requireAdmin(locale);
  const orgId = session.user.orgId;

  const t = await getTranslations("audit");
  const format = await getFormatter();

  const sp = new URLSearchParams();
  if (pageParam) sp.set("page", pageParam);
  const pagination = parsePagination(sp);

  const action = AUDIT_ACTIONS.includes(actionParam as AuditActionValue)
    ? (actionParam as AuditActionValue)
    : undefined;
  const entityType = entityParam || undefined;

  const { data, total } = await listAuditLog(orgId, { action, entityType }, pagination);
  const { totalPages, page } = paginatedResponse(data, total, pagination);
  const hasFilter = Boolean(action || entityType);

  function pageHref(p: number): string {
    const q = new URLSearchParams();
    q.set("page", String(p));
    if (action) q.set("action", action);
    if (entityType) q.set("entityType", entityType);
    return `/app/audit?${q.toString()}`;
  }
  const exportQs = new URLSearchParams();
  if (action) exportQs.set("action", action);
  if (entityType) exportQs.set("entityType", entityType);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <AuditFilter currentAction={action ?? ""} currentEntity={entityType ?? ""} />
        <Button asChild variant="outline">
          <a href={`/api/audit-log/export${exportQs.toString() ? `?${exportQs.toString()}` : ""}`}>
            <Download className="size-4" />
            {t("export")}
          </a>
        </Button>
      </div>

      {data.length === 0 ? (
        <Card>
          <CardContent className="px-1 py-10 text-center text-sm text-muted-foreground">
            {hasFilter ? t("empty") : t("emptyAll")}
          </CardContent>
        </Card>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colTime")}</TableHead>
                <TableHead>{t("colActor")}</TableHead>
                <TableHead>{t("colAction")}</TableHead>
                <TableHead>{t("colEntity")}</TableHead>
                <TableHead>{t("colChanges")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                    {format.dateTime(r.timestamp, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.actorName || r.actorEmail ? (
                      <span className="text-foreground">{r.actorName ?? r.actorEmail}</span>
                    ) : (
                      <span className="text-muted-foreground">{t("actorSystem")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ACTION_VARIANT[r.action] ?? "outline"}>
                      {t(`action${r.action}` as `action${"CREATE" | "UPDATE" | "DELETE" | "RESTORE"}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="text-foreground">{r.entityType}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{r.entityId}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.changedFields.length ? r.changedFields.join(", ") : t("noChanges")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-3">
              <span className="text-sm text-muted-foreground tabular-nums">
                {format.number(page)} / {format.number(totalPages)}
              </span>
              {page <= 1 ? (
                <Button variant="outline" size="sm" disabled>
                  ‹
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(page - 1)} aria-label={String(page - 1)}>
                    ‹
                  </Link>
                </Button>
              )}
              {page >= totalPages ? (
                <Button variant="outline" size="sm" disabled>
                  ›
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(page + 1)} aria-label={String(page + 1)}>
                    ›
                  </Link>
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
