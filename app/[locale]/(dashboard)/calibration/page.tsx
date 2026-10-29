"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CyclePicker } from "@/components/pms/CyclePicker";
import { PublishGate } from "@/components/pms/PublishGate";
import { ScoreRunPanel } from "@/components/pms/ScoreRunPanel";
import { CalibrationTargetEditor } from "@/components/pms/CalibrationTargetEditor";
import { BandDistributionChart } from "@/components/pms/BandDistributionChart";
import { NineBox } from "@/components/pms/NineBox";
import type { NineBoxCell } from "@/lib/pms/distribution";
import { useCycleSelection } from "@/hooks/use-cycle-selection";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { apiClient } from "@/lib/api-client";

/**
 * §10 — calibration, and §13.2's publish gate that follows it.
 *
 * ## Guided, never forced (§10.4)
 *
 * The screen shows "the target distribution vs. actual, and the gap", and offers
 * a band move per person. It does not propose WHO should move, and there is no
 * "apply the curve" button: §10.4 says HR "moves individuals with justification"
 * and that the process is "guided, not forced". A system that suggested names
 * would be making the judgement the clause reserves for a person, and the
 * justification would become a rubber stamp on the machine's choice.
 *
 * ## HRBP does not touch this (§10.6)
 *
 * "HRBP does not touch calibration." The whole screen is gated on
 * `capabilities.runCalibration`, which is HR Super Admin only, and both routes
 * check `isHrSuperAdmin` for themselves.
 *
 * ## Every move carries a reason (§10.5)
 *
 * The reason field is required before the button enables, and the route rejects
 * a blank one regardless — the database CHECK-constrains it non-blank as well.
 * Three layers, because an unexplained override is the thing §10 exists to
 * prevent and §13.5's master export has to be able to show the why.
 */

const BANDS = ["OUTSTANDING", "EXCELLENT", "TARGET", "ALMOST_ACHIEVED", "UNSATISFACTORY"];

interface GapRow {
  band: string;
  actualCount: number;
  actualPct: string;
  targetPct: string;
  deltaCount: string;
}

interface CalibrationResponse {
  cycleId: string;
  readiness: { ready: boolean; reason: string | null };
  minDepartmentSize: number;
  target: Record<string, unknown> | null;
  orgWide: GapRow[];
  departments: Array<{
    id: string;
    name: string;
    headcount: number;
    curveEligible: boolean;
    gap: GapRow[];
    employees: Array<{
      employeeScoreId: string;
      employeeId: string;
      name: string;
      rawScore: string;
      rawBand: string;
      calibratedBand: string;
      /** Red-team F8. `null` is "unknown", never "nobody rated them". */
      threeSixtyRaterCount: number | null;
      /** P2-1 — last cycle's calibrated band; null when not scored then. */
      priorBand: string | null;
    }>;
  }>;
  headcount: number;
  targetPctByBand: Record<string, number> | null;
  prior: { year: number; headcount: number; counts: Record<string, number> } | null;
  nineBox: { cells: NineBoxCell[]; withoutFeedback: number };
}

export default function CalibrationPage() {
  const t = useTranslations("pms.calibration");
  const { capabilities, isLoading: actorLoading } = usePmsActor();
  const { cycles, cycleList, cycleId, selectedCycleId, setSelectedCycleId } = useCycleSelection();

  const calibration = useQuery({
    queryKey: ["pms", "calibration", cycleId],
    queryFn: () => apiClient.get<CalibrationResponse>(`/api/calibration?cycleId=${cycleId}`),
    enabled: cycleId !== null,
  });

  if (actorLoading || cycles.isLoading) return <PageSkeleton />;

  if (!capabilities.runCalibration) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("notPermitted")}>
          {/* §10.6 names HRBP explicitly, so the message does too — "you don't
              have permission" would leave an HRBP wondering if it is a bug. */}
          <EmptyState description={t("notPermittedHelp")} />
        </SectionCard>
      </div>
    );
  }

  if (cycleList.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("noCycles")}>
          <EmptyState description={t("noCyclesHelp")} />
        </SectionCard>
      </div>
    );
  }

  const data = calibration.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <CyclePicker
            cycles={cycleList}
            value={selectedCycleId ?? cycleId}
            onChange={setSelectedCycleId}
          />
        }
      />

      {calibration.isLoading && <PageSkeleton />}

      {calibration.isError && (
        <SectionCard title={t("loadFailed")}>
          <EmptyState
            description={t("loadFailedHelp")}
            actionLabel={t("retry")}
            onAction={() => void calibration.refetch()}
          />
        </SectionCard>
      )}

      {data && (
        <>
          {/* §10.7's preceding step. Above the readiness card deliberately: the
              card's usual complaint is that raw scores are missing, and the
              answer to it is this panel's button. */}
          {cycleId && <ScoreRunPanel cycleId={cycleId} />}

          {/* §10.2 — the target every gap below is measured against. Above the
              tables because without it they have nothing to compare to, and
              §10.7 refuses calibration until it exists. */}
          {cycleId && (
            <CalibrationTargetEditor
              cycleId={cycleId}
              target={data.target}
              minDepartmentSize={data.minDepartmentSize}
            />
          )}

          {/* §10.7 — "no release until calibration is done", and no calibration
              until every raw score is in. Stated first, because it decides
              whether anything below is meaningful. */}
          {!data.readiness.ready && (
            <SectionCard title={t("notReady")}>
              <EmptyState description={data.readiness.reason ?? t("notReadyHelp")} />
            </SectionCard>
          )}

          <SectionCard title={t("orgWide")} subtitle={t("orgWideHelp")}>
            <div className="space-y-4">
              <GapTable rows={data.orgWide} />
              {/* P2-1 — the curve itself: actual vs target, and last cycle. */}
              <BandDistributionChart
                counts={Object.fromEntries(data.orgWide.map((r) => [r.band, r.actualCount]))}
                headcount={data.headcount}
                targetPct={data.targetPctByBand}
                prior={data.prior}
              />
            </div>
          </SectionCard>

          {data.headcount > 0 && (
            <SectionCard title={t("nineBoxTitle")} subtitle={t("nineBoxHelp")}>
              <NineBox cells={data.nineBox.cells} withoutFeedback={data.nineBox.withoutFeedback} />
            </SectionCard>
          )}

          {data.departments.map((department) => (
            <SectionCard
              key={department.id}
              title={department.name}
              subtitle={
                department.curveEligible
                  ? t("headcount", { count: department.headcount })
                  : t("belowThreshold", {
                      count: department.headcount,
                      min: data.minDepartmentSize,
                    })
              }
            >
              <div className="space-y-4">
                <GapTable rows={department.gap} />
                <ul className="space-y-2">
                  {department.employees.map((employee) => (
                    <AdjustRow
                      key={employee.employeeScoreId}
                      employee={employee}
                      cycleId={cycleId ?? ""}
                    />
                  ))}
                </ul>
              </div>
            </SectionCard>
          ))}

          {cycleId && <PublishGate cycleId={cycleId} />}
        </>
      )}
    </div>
  );
}

/** §10.4's "target distribution vs. actual, and the gap" — the whole guidance. */
function GapTable({ rows }: { rows: GapRow[] }) {
  const t = useTranslations("pms.calibration");
  const tBand = useTranslations("pms.band");
  return (
    <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {rows.map((row) => {
        const delta = Number(row.deltaCount);
        return (
          <li key={row.band} className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground">{tBand(row.band)}</div>
            <div className="text-xl font-semibold">{row.actualCount}</div>
            <div className="text-xs text-muted-foreground">
              {row.actualPct}% · {t("targetPct", { pct: row.targetPct })}
            </div>
            {/* The gap, signed. Neutral tone deliberately: §10.4 is guidance, and
                a red badge would read as a rule being broken. */}
            <Badge variant="outline" className="mt-1">
              {delta > 0 ? `+${row.deltaCount}` : row.deltaCount}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

/** One person's band, with §10.5's mandatory reason attached to the move. */
function AdjustRow({
  employee,
  cycleId,
}: {
  employee: {
    employeeScoreId: string;
    employeeId: string;
    name: string;
    rawScore: string;
    rawBand: string;
    calibratedBand: string;
    threeSixtyRaterCount: number | null;
    priorBand: string | null;
  };
  cycleId: string;
}) {
  const t = useTranslations("pms.calibration");
  const tBand = useTranslations("pms.band");
  const queryClient = useQueryClient();
  const [toBand, setToBand] = useState(employee.calibratedBand);
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post("/api/calibration", {
        employeeScoreId: employee.employeeScoreId,
        toBand,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success(t("adjusted", { name: employee.name }));
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["pms", "calibration", cycleId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const moved = employee.rawBand !== employee.calibratedBand;
  const changed = toBand !== employee.calibratedBand;

  return (
    <li className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
      <div className="min-w-40 flex-1">
        <div className="font-medium">{employee.name}</div>
        <div className="text-xs text-muted-foreground">
          {t("rawScore", { score: employee.rawScore })} · {tBand(employee.rawBand)}
          {/* §10.1's separate layer, visible: raw stays, the calibrated band
              is what moved. */}
          {moved && ` → ${tBand(employee.calibratedBand)}`}
        </div>
        {/* P2-1 — prior-cycle comparison, per person. */}
        <div className="text-xs text-muted-foreground">
          {employee.priorBand
            ? t("priorBand", { band: tBand(employee.priorBand) })
            : t("noPriorBand")}
        </div>
        {/*
          Red-team F8 — §9.5 averages over however many raters arrived, so this
          score may rest on one 360 form rather than the three §9.4 intends.
          §10.5 gives HR a manual override on every department; this is the fact
          that override exists to act on, so it is stated here where the
          judgement is made. It moves no band by itself — a thin sample is a
          reason to look, not a rule.

          Shown for EVERY score, not only the thin ones (operator request). The
          count is the denominator the 360 component rests on, so "averaged over
          4 raters" is as much a part of reading this row as the score itself —
          and a reviewer who only ever sees the number when something is wrong
          cannot tell a healthy sample from a missing one.

          The CAUTION styling still belongs to the thin case alone, and only
          when the count is KNOWN: a run written before the column existed
          carries null, and "unknown" rendered as a warning would accuse a real
          score of a thinness nobody measured.
        */}
        {employee.threeSixtyRaterCount === null ? (
          <p className="text-xs text-muted-foreground">{t("raterCountUnknown")}</p>
        ) : employee.threeSixtyRaterCount < 3 ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {t("thinThreeSixty", { count: employee.threeSixtyRaterCount })}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("raterCount", { count: employee.threeSixtyRaterCount })}
          </p>
        )}
      </div>

      <div className="w-48">
        <Label htmlFor={`band-${employee.employeeScoreId}`} className="text-xs">
          {t("band")}
        </Label>
        <Select value={toBand} onValueChange={setToBand}>
          <SelectTrigger id={`band-${employee.employeeScoreId}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BANDS.map((band) => (
              <SelectItem key={band} value={band}>
                {tBand(band)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-56 flex-1">
        <Label htmlFor={`reason-${employee.employeeScoreId}`} className="text-xs">
          {t("reason")}
        </Label>
        <Input
          id={`reason-${employee.employeeScoreId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("reasonPlaceholder")}
        />
      </div>

      <Button
        size="sm"
        // §10.5 — no move without a reason, enforced here, at the route, and by
        // a CHECK constraint.
        disabled={!changed || reason.trim() === "" || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? t("saving") : t("moveAction")}
      </Button>
    </li>
  );
}
