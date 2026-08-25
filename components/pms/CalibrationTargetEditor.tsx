"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";

/**
 * §10.2 — "HR Super Admin defines an editable target distribution across the
 * five bands", and §10.3's editable department threshold.
 *
 * ## Why this exists
 *
 * `PUT /api/calibration` had no caller. The calibration screen READ the target
 * and drew the gap against it, but nothing in the product could set one — and
 * §10.7's readiness check refuses calibration without a target, so the gate was
 * shut with no key. A cycle could reach "every raw score is in" and stop there
 * permanently (`docs/verification/SPEC-REDTEAM.md`, F2).
 *
 * ## The total is checked here and enforced there
 *
 * §10.2's five percentages describe a distribution, so they must total 100. The
 * running total is shown live and Save is disabled off it, but the zod schema
 * refuses it too — this is guidance, not the control. An operator should learn
 * the rule by reading the screen rather than by being rejected.
 *
 * ## What this screen deliberately does NOT do
 *
 * Move anybody. §10.4 is explicit that calibration is "guided, not forced" and
 * that the system "does not mathematically force people into bands". Setting the
 * target changes what the gap says; it never changes a band. Those are the
 * adjustment rows below, each with §10.5's mandatory reason.
 */

/**
 * §8.7's bands, best to worst, paired with their column.
 *
 * Declared here rather than imported from `lib/pms/calibration`: that module
 * pulls the Prisma runtime for `Decimal`, which has no business in a browser
 * bundle. The calibration page keeps its own list for the same reason.
 */
const TARGET_FIELDS = [
  { band: "OUTSTANDING", field: "outstandingPct" },
  { band: "EXCELLENT", field: "excellentPct" },
  { band: "TARGET", field: "targetPct" },
  { band: "ALMOST_ACHIEVED", field: "almostAchievedPct" },
  { band: "UNSATISFACTORY", field: "unsatisfactoryPct" },
] as const;

/** §10.2's own example shape — a sane starting point, not a recommendation. */
const SUGGESTED: Record<string, string> = {
  outstandingPct: "10",
  excellentPct: "20",
  targetPct: "40",
  almostAchievedPct: "20",
  unsatisfactoryPct: "10",
};

type TargetRow = Record<string, unknown> | null;

export function CalibrationTargetEditor({
  cycleId,
  target,
  minDepartmentSize,
}: {
  cycleId: string;
  target: TargetRow;
  minDepartmentSize: number;
}) {
  const t = useTranslations("pms.calibrationTarget");
  const tBand = useTranslations("pms.band");
  const queryClient = useQueryClient();

  const [pcts, setPcts] = useState<Record<string, string>>(SUGGESTED);
  const [minSize, setMinSize] = useState(String(minDepartmentSize));
  const [editing, setEditing] = useState(false);

  // The server's values win whenever they change — a target someone else just
  // set must not be masked by this component's initial state.
  useEffect(() => {
    if (!target) return;
    const next: Record<string, string> = {};
    for (const { field } of TARGET_FIELDS) {
      const raw = target[field];
      if (raw !== undefined && raw !== null) next[field] = String(raw);
    }
    setPcts((current) => ({ ...current, ...next }));
  }, [target]);

  useEffect(() => setMinSize(String(minDepartmentSize)), [minDepartmentSize]);

  const total = TARGET_FIELDS.reduce((sum, { field }) => sum + (Number(pcts[field]) || 0), 0);
  // Compared at 2dp, the same precision the schema rounds to, so the screen and
  // the route agree about what "100" means.
  const totalsHundred = Math.round(total * 100) === 10_000;

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.put("/api/calibration", {
        cycleId,
        ...Object.fromEntries(TARGET_FIELDS.map(({ field }) => [field, Number(pcts[field]) || 0])),
        minDepartmentSize: Number(minSize) || 5,
      }),
    onSuccess: () => {
      toast.success(t("savedToast"));
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["pms", "calibration", cycleId] });
      // §13.2's readiness counts "no target distribution set" as a blocker, and
      // the publish gate holds its own query — without this it keeps reporting
      // the blocker the operator has just cleared, two cards further down the
      // same screen.
      void queryClient.invalidateQueries({ queryKey: ["pms", "publish", cycleId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!target && !editing) {
    return (
      <SectionCard
        title={t("title")}
        subtitle={t("help")}
        actions={<Button onClick={() => setEditing(true)}>{t("setAction")}</Button>}
      >
        {/* §10.7 refuses calibration without a target, so this empty state names
            the consequence rather than just the absence. */}
        <EmptyState description={t("noTargetHelp")} />
      </SectionCard>
    );
  }

  const readOnly = !!target && !editing;

  return (
    <SectionCard
      title={t("title")}
      subtitle={t("help")}
      actions={
        readOnly ? (
          <Button variant="outline" onClick={() => setEditing(true)}>
            {t("editAction")}
          </Button>
        ) : (
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !totalsHundred}>
            {mutation.isPending ? t("working") : t("saveAction")}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {TARGET_FIELDS.map(({ band, field }) => {
            return (
              <div key={band} className="space-y-1">
                <Label htmlFor={`target-${field}`}>{tBand(band)}</Label>
                <Input
                  id={`target-${field}`}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  inputMode="decimal"
                  disabled={readOnly}
                  value={pcts[field] ?? ""}
                  onChange={(e) => setPcts((p) => ({ ...p, [field]: e.target.value }))}
                />
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={totalsHundred ? "success" : "warning"}>
            {t("total", { pct: total.toFixed(2) })}
          </Badge>
          {!totalsHundred && (
            <span className="text-sm text-destructive-emphasis">{t("mustTotal")}</span>
          )}
        </div>

        <div className="max-w-xs space-y-1">
          <Label htmlFor="target-min-size">{t("minSize")}</Label>
          <Input
            id="target-min-size"
            type="number"
            min={2}
            max={500}
            step="1"
            inputMode="numeric"
            disabled={readOnly}
            value={minSize}
            onChange={(e) => setMinSize(e.target.value)}
          />
          {/* §10.3 — the threshold decides which departments get a curve at all,
              so the screen says what changing it does. */}
          <p className="text-xs text-muted-foreground">{t("minSizeHelp")}</p>
        </div>
      </div>
    </SectionCard>
  );
}
