"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { KPI_LEVEL_FIELDS } from "@/components/pms/KpiForm";
import type { KpiRecord } from "@/components/pms/KpiDraftBoard";

/**
 * The drafted KPI set — §5.2's six authored texts per KPI, rendered.
 *
 * Split out of `KpiDraftBoard` when it crossed the complexity budget. The seam
 * is presentational on purpose: this component decides nothing. Whether an edit
 * is allowed is the server's answer (`editBlockedReason`), passed down as
 * `canEdit`, so a control that appears here has already been permitted rather
 * than being permitted by appearing.
 *
 * All five levels are always shown, in §5.2's order with its numeric values —
 * a KPI whose "Unsatisfactory" is missing is a rating scale the employee cannot
 * read, which is why the schema requires all six texts. The order comes from
 * `KPI_LEVEL_FIELDS` in KpiForm rather than a second list here: the form that
 * writes the descriptors and the view that renders them must not be able to
 * disagree about which five they are.
 */

export function KpiList({
  kpis,
  canEdit,
  busyId,
  onEdit,
  onDelete,
}: {
  kpis: KpiRecord[];
  canEdit: boolean;
  busyId: string | null;
  onEdit: (kpi: KpiRecord) => void;
  onDelete: (kpi: KpiRecord) => void;
}) {
  const t = useTranslations("pms.kpi");

  return (
    <ul className="flex list-none flex-col gap-4 p-0">
      {kpis.map((kpi) => (
        <li key={kpi.id} className="rounded-md border border-border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium text-foreground">{kpi.description}</p>
              <p className="text-xs text-muted-foreground">
                {t("kpiWeightage", { weightage: kpi.weightage })}
              </p>
            </div>
            {canEdit ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === kpi.id}
                  onClick={() => onEdit(kpi)}
                >
                  <Pencil className="h-4 w-4" />
                  {t("editAction")}
                </Button>
                <ConfirmAction
                  title={t("deleteConfirmTitle")}
                  description={t("deleteConfirmBody")}
                  okText={t("deleteAction")}
                  okType="danger"
                  onConfirm={() => onDelete(kpi)}
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === kpi.id}
                    aria-label={t("deleteAction")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </ConfirmAction>
              </div>
            ) : null}
          </div>

          {/* UX P1 (perf-jml P1-7): the five-level rubric is reference text,
              so it folds away instead of adding ~450px per KPI. */}
          <details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              {t("descriptorsToggle")}
            </summary>
            <div className="mt-3">
              <DescriptionList
                bordered={false}
                columns={1}
                size="small"
                items={KPI_LEVEL_FIELDS.map((level) => ({
                  key: level.field,
                  label: (
                    <span className="flex flex-wrap items-center gap-2">
                      {t(`level.${level.field}`)}
                      <Badge variant="outline">{t("levelValue", { value: level.value })}</Badge>
                    </span>
                  ),
                  value: kpi[level.field],
                }))}
              />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
