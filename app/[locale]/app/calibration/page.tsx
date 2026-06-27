import { getTranslations, getFormatter } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { requireAdmin } from "@/lib/authz";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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
import {
  listOutcomeCaptureRows,
  listRoleCalibrationStatus,
  getLatestCalibration,
  getAdverseImpact,
} from "@/lib/services/calibration";
import { OutcomeForm } from "./OutcomeForm";
import { CalibrationReportPanel } from "./CalibrationReportPanel";

// Calibration (UI-SPEC D.9, ARCHITECTURE §7/§11) — admin only. Three sections:
// outcome capture, the per-role-version calibration report (charts + advisory
// suggestions), and the org-wide selection-rate / adverse-impact monitor. Reads are
// RSC via the tenant-scoped service; the only client islands are the outcome form
// and the report panel's selector/generate action. Audit is automatic on writes.
export default async function CalibrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; role?: string }>;
}) {
  const { locale } = await params;
  const { page: pageParam, role: roleParam } = await searchParams;
  const session = await requireAdmin(locale);
  const orgId = session.user.orgId;

  const t = await getTranslations("calibration");
  const tDecision = await getTranslations("candidates.decision");
  const tPage = await getTranslations("candidates");
  const format = await getFormatter();

  const sp = new URLSearchParams();
  if (pageParam) sp.set("page", pageParam);
  const pagination = parsePagination(sp);

  const [capture, roleStatuses, adverse] = orgId
    ? await Promise.all([
        listOutcomeCaptureRows(orgId, { skip: pagination.skip, take: pagination.take }),
        listRoleCalibrationStatus(orgId),
        getAdverseImpact(orgId),
      ])
    : [{ data: [], total: 0 }, [], { rows: [], total: 0, dbTotal: 0, capped: false }];

  // Selected role for the report (query param, else the first calibratable role).
  const selectedRoleId =
    (roleParam && roleStatuses.some((r) => r.roleProfileId === roleParam) ? roleParam : null) ??
    roleStatuses[0]?.roleProfileId ??
    null;
  const storedRaw = orgId && selectedRoleId ? await getLatestCalibration(orgId, selectedRoleId) : null;
  // Serialize Date → ISO across the RSC→client boundary (the panel re-parses).
  const stored = storedRaw
    ? { ...storedRaw, generatedAt: storedRaw.generatedAt.toISOString() }
    : null;

  const { totalPages, page } = paginatedResponse(capture.data, capture.total, pagination);

  function pageHref(p: number): string {
    const q = new URLSearchParams();
    q.set("page", String(p));
    if (selectedRoleId) q.set("role", selectedRoleId);
    return `/app/calibration?${q.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {/* (1) Outcome capture */}
      <Card>
        <CardHeader>
          <CardTitle>{t("captureTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("captureSubtitle")}</p>
        </CardHeader>
        <CardContent>
          {capture.data.length === 0 ? (
            <p className="px-1 py-6 text-sm text-muted-foreground">{t("captureEmpty")}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colCandidate")}</TableHead>
                    <TableHead>{t("colRole")}</TableHead>
                    <TableHead className="text-end">{t("colFit")}</TableHead>
                    <TableHead>{t("colDecision")}</TableHead>
                    <TableHead>{t("colOutcome")}</TableHead>
                    <TableHead className="text-end">{t("colAction")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {capture.data.map((row) => (
                    <TableRow key={row.resultId}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">
                            {row.candidateName || row.candidateEmail}
                          </span>
                          {row.candidateName && (
                            <span className="text-xs text-muted-foreground">{row.candidateEmail}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-foreground">{row.roleTitle}</span>
                        <span className="block text-xs text-muted-foreground">{row.roleFamily}</span>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{row.fitScore}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.decision ? tDecision(row.decision) : t("decisionNone")}
                      </TableCell>
                      <TableCell>
                        {row.outcome ? (
                          <Badge variant={row.outcome.hired ? "pass" : "outline"}>
                            {row.outcome.hired ? t("outcomeHired") : t("outcomeNotHired")}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">{t("outcomeNone")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <OutcomeForm row={row} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-end gap-3">
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {tPage("pageOf", { page, totalPages })}
                  </span>
                  {page <= 1 ? (
                    <Button variant="outline" size="sm" disabled>
                      {tPage("prev")}
                    </Button>
                  ) : (
                    <Button asChild variant="outline" size="sm">
                      <Link href={pageHref(page - 1)}>{tPage("prev")}</Link>
                    </Button>
                  )}
                  {page >= totalPages ? (
                    <Button variant="outline" size="sm" disabled>
                      {tPage("next")}
                    </Button>
                  ) : (
                    <Button asChild variant="outline" size="sm">
                      <Link href={pageHref(page + 1)}>{tPage("next")}</Link>
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* (2) Calibration report */}
      <Card>
        <CardHeader>
          <CardTitle>{t("reportTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("reportSubtitle")}</p>
        </CardHeader>
        <CardContent>
          <CalibrationReportPanel roles={roleStatuses} selectedRoleId={selectedRoleId} stored={stored} />
        </CardContent>
      </Card>

      {/* (3) Selection-rate / adverse-impact monitor */}
      <Card>
        <CardHeader>
          <CardTitle>{t("adverseTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("adverseSubtitle")}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {adverse.rows.length === 0 ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">{t("adverseEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("adverseGroup")}</TableHead>
                  <TableHead className="text-end">{t("adverseTotal")}</TableHead>
                  <TableHead className="text-end">{t("adverseSelected")}</TableHead>
                  <TableHead className="text-end">{t("adverseRate")}</TableHead>
                  <TableHead className="text-end">{t("adversePass")}</TableHead>
                  <TableHead>{t("adverseStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adverse.rows.map((r) => (
                  <TableRow key={r.group}>
                    <TableCell className="font-medium text-foreground">{r.group}</TableCell>
                    <TableCell className="text-end tabular-nums">{format.number(r.total)}</TableCell>
                    <TableCell className="text-end tabular-nums">{format.number(r.selected)}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {format.number(r.selectionRate, { style: "percent", maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {format.number(r.passRate, { style: "percent", maximumFractionDigits: 0 })}
                    </TableCell>
                    <TableCell>
                      {r.adverseFlag ? (
                        <Badge variant="below">{t("adverseFlagged")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("adverseOk")}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {adverse.capped && (
            <p className="text-xs text-[var(--signal-partial-ink)]">
              {t("adverseCapped", { shown: format.number(adverse.total), total: format.number(adverse.dbTotal) })}
            </p>
          )}
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-[var(--signal-partial-ink)]" />
            {t("adverseDemographicNote")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
