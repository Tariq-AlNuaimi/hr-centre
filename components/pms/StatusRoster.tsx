"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";

/**
 * §13.3's roster — one row per person, one column per stage.
 *
 * The states come straight from `lib/pms/status.ts` (§13.4's shared engine), so
 * this component NEVER derives a status of its own. That is the point of the
 * clause: "one engine, filtered by role" is defeated the moment a screen decides
 * for itself what "in progress" means.
 *
 * §13.3 — "Shows status, scores, and bands — never salary or bonus." There is no
 * compensation column here and the payload carries none.
 */

export type StatusRow = {
  participantId: string;
  employeeId: string;
  name: string;
  employeeNumber: string;
  managerName: string | null;
  department: string | null;
  entity: string;
  goalSettingExempt: boolean;
  kpiCount: number;
  weightageTotal: string;
  weightageComplete: boolean;
  goalSettingState: string;
  yearEndState: string;
  outstandingLabel: string | null;
  selfRatedCount: number;
  managerRatedCount: number;
  band: string | null;
  score: string | null;
};

/**
 * Tone per state. `AWAITING_*` is amber rather than red because the deadline,
 * not the state, decides whether something is late — §5.4's lock is the server's
 * answer and it arrives separately as `outstandingLabel`.
 */
const TONE: Record<string, "success" | "warning" | "outline"> = {
  COMPLETE: "success",
  AWAITING_HR: "warning",
  AWAITING_MANAGER: "warning",
  AWAITING_EMPLOYEE: "warning",
  IN_PROGRESS: "outline",
  NOT_STARTED: "outline",
  NOT_APPLICABLE: "outline",
};

export function StatusRoster({
  rows,
  loading,
  showScores,
}: {
  rows: StatusRow[];
  loading?: boolean;
  showScores: boolean;
}) {
  const t = useTranslations("pms.team");
  const tBand = useTranslations("pms.band");

  return (
    <DataTable<StatusRow>
      rowKey="participantId"
      dataSource={rows}
      loading={loading}
      total={rows.length}
      page={1}
      pageSize={rows.length || 1}
      columns={[
        {
          key: "name",
          title: t("employee"),
          render: (_value: unknown, row: StatusRow) => (
            <div>
              <div className="font-medium">{row.name}</div>
              <div className="text-xs text-muted-foreground">
                {row.department ?? row.entity} · {row.employeeNumber}
              </div>
            </div>
          ),
        },
        {
          key: "goalSetting",
          title: t("goalSetting"),
          render: (_value: unknown, row: StatusRow) => (
            <div className="space-y-1">
              <Badge variant={TONE[row.goalSettingState] ?? "outline"}>
                {t(`state.${row.goalSettingState}`)}
              </Badge>
              {/* §5.3 — the gap to 100%, which is the number a manager acts on. */}
              {!row.goalSettingExempt && !row.weightageComplete && row.kpiCount > 0 && (
                <div className="text-xs text-muted-foreground">
                  {t("weightage", { total: row.weightageTotal })}
                </div>
              )}
              {/* §5.4's verbatim status for a stage that locked with a party owing. */}
              {row.outstandingLabel && (
                <div className="text-xs text-destructive-emphasis">
                  {t(`outstandingLabel.${row.outstandingLabel}`)}
                </div>
              )}
            </div>
          ),
        },
        {
          key: "yearEnd",
          title: t("yearEnd"),
          render: (_value: unknown, row: StatusRow) => (
            <div className="space-y-1">
              <Badge variant={TONE[row.yearEndState] ?? "outline"}>
                {t(`state.${row.yearEndState}`)}
              </Badge>
              {row.yearEndState !== "NOT_APPLICABLE" && row.kpiCount > 0 && (
                <div className="text-xs text-muted-foreground">
                  {t("rated", {
                    self: row.selfRatedCount,
                    manager: row.managerRatedCount,
                    total: row.kpiCount,
                  })}
                </div>
              )}
            </div>
          ),
        },
        ...(showScores
          ? [
              {
                key: "result",
                title: t("result"),
                render: (_value: unknown, row: StatusRow) =>
                  row.band ? (
                    <div className="space-y-1">
                      <Badge variant="brand">{tBand(row.band)}</Badge>
                      <div className="text-xs text-muted-foreground">{row.score}</div>
                    </div>
                  ) : (
                    // Honest empty — §13.2 hides results until publication, so
                    // "not yet" is the truth, not a missing value.
                    <span className="text-xs text-muted-foreground">{t("noResultYet")}</span>
                  ),
              },
            ]
          : []),
      ]}
    />
  );
}
