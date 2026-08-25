"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/shared/SectionCard";
import { KPI_LEVEL_FIELDS } from "@/components/pms/KpiForm";
import {
  minimalEdit,
  proposedTotal,
  TEXTAREA_CLASS,
  type ComposerKpi,
  type Draft,
  type MinimalEdit,
} from "./change-request-draft";

/**
 * The manager's side of §6.2 — proposing a mid-year change to an approved KPI
 * baseline.
 *
 * ## Why the whole set is on screen, not just the KPI being changed
 *
 * §6.2 reads as though a manager changes "a KPI". §5.3 requires the set to total
 * exactly 100, so changing one weightage necessarily unbalances it — and unlike
 * goal-setting, mid-year has no sign-off to catch that before the year is
 * scored. The request therefore carries the rebalance with it, and the screen
 * shows the running total the whole time so the manager sees the consequence
 * while they are writing rather than days later in a rejection.
 *
 * ## What is sent
 *
 * Only fields that actually MOVED. A field left at its current value is not part
 * of the request — that is how §6.2's "descriptors/metrics only" partial change
 * is expressed against a full overhaul, and the API refuses an edit in which
 * nothing changed at all.
 *
 * ## What this screen deliberately cannot do
 *
 * Apply anything. A submitted request changes no KPI; the baseline stays exactly
 * as HR approved it (§5.1) until HR approves the change too. There is no "urgent"
 * path and no self-approval, because §6.2 gives the decision to HR alone.
 */

export function ChangeRequestComposer({
  kpis,
  submitting,
  blockedReason,
  onSubmit,
}: {
  kpis: ComposerKpi[];
  submitting: boolean;
  /** Why the manager cannot raise one right now (§5.1/§5.4/§2), or null. */
  blockedReason: string | null;
  onSubmit: (payload: { rationale: string; edits: MinimalEdit[] }) => void;
}) {
  const t = useTranslations("pms.changeRequest");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rationale, setRationale] = useState("");

  const editing = (id: string) => drafts[id] !== undefined;

  const open = (kpi: ComposerKpi) =>
    setDrafts((d) => ({
      ...d,
      [kpi.id]: {
        kpiId: kpi.id,
        description: kpi.description,
        weightage: kpi.weightage,
        descriptorOutstanding: kpi.descriptorOutstanding,
        descriptorExcellent: kpi.descriptorExcellent,
        descriptorTarget: kpi.descriptorTarget,
        descriptorAlmostAchieved: kpi.descriptorAlmostAchieved,
        descriptorUnsatisfactory: kpi.descriptorUnsatisfactory,
      },
    }));

  const close = (id: string) =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });

  const set = (id: string, field: keyof Draft, value: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [field]: value } }));

  // The §5.3 arithmetic, run on every keystroke so the gap is never a surprise.
  const total = useMemo(() => proposedTotal(kpis, drafts), [kpis, drafts]);
  // Only the fields that MOVED travel: absence is how "unchanged" is expressed
  // everywhere downstream, and sending a prefilled field back as if it were an
  // edit puts six fields nobody touched into §6.3's permanent history.
  const changed = useMemo(() => {
    const out: MinimalEdit[] = [];
    for (const draft of Object.values(drafts)) {
      const live = kpis.find((k) => k.id === draft.kpiId);
      const minimal = live ? minimalEdit(live, draft) : null;
      if (minimal) out.push(minimal);
    }
    return out;
  }, [kpis, drafts]);

  const balanced = total === "100";
  const canSubmit =
    blockedReason === null &&
    !submitting &&
    changed.length > 0 &&
    rationale.trim() !== "" &&
    balanced;

  return (
    <SectionCard title={t("title")} subtitle={t("subtitle")}>
      {blockedReason ? (
        <p className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {blockedReason}
        </p>
      ) : null}

      <div className="space-y-4">
        {kpis.map((kpi) => (
          <div key={kpi.id} className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{kpi.description}</p>
                <p className="text-xs text-muted-foreground">
                  {t("currentWeightage", { value: kpi.weightage })}
                </p>
              </div>
              {editing(kpi.id) ? (
                <Button variant="ghost" size="sm" onClick={() => close(kpi.id)}>
                  {t("discardEdit")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={blockedReason !== null}
                  onClick={() => open(kpi)}
                >
                  {t("proposeEdit")}
                </Button>
              )}
            </div>

            {editing(kpi.id) ? (
              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`d-${kpi.id}`}>{t("field.description")}</Label>
                  <textarea
                    id={`d-${kpi.id}`}
                    className={TEXTAREA_CLASS}
                    value={drafts[kpi.id].description}
                    onChange={(e) => set(kpi.id, "description", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`w-${kpi.id}`}>{t("field.weightage")}</Label>
                  <Input
                    id={`w-${kpi.id}`}
                    inputMode="decimal"
                    value={drafts[kpi.id].weightage}
                    onChange={(e) => set(kpi.id, "weightage", e.target.value)}
                  />
                </div>
                {KPI_LEVEL_FIELDS.map(({ field, value }) => (
                  <div key={field} className="space-y-1.5">
                    <Label htmlFor={`${field}-${kpi.id}`}>
                      {t(`field.${field}`)} · {value}
                    </Label>
                    <textarea
                      id={`${field}-${kpi.id}`}
                      className={TEXTAREA_CLASS}
                      value={drafts[kpi.id][field]}
                      onChange={(e) => set(kpi.id, field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* §5.3, stated continuously. Not a keystroke-level block — the manager is
          mid-thought while rebalancing — but the submit button stays disabled
          until it lands on 100, because the API will refuse anything else. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Badge variant={balanced ? "success" : "warning"}>{t("proposedTotal", { total })}</Badge>
        {!balanced ? <span className="text-sm text-muted-foreground">{t("mustTotal")}</span> : null}
      </div>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="cr-rationale">{t("rationaleLabel")}</Label>
        <textarea
          id="cr-rationale"
          className={TEXTAREA_CLASS}
          placeholder={t("rationalePlaceholder")}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          disabled={blockedReason !== null}
        />
        <p className="text-xs text-muted-foreground">{t("rationaleHelp")}</p>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          disabled={!canSubmit}
          onClick={() => onSubmit({ rationale: rationale.trim(), edits: changed })}
        >
          {submitting ? t("submitting") : t("submit")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t("editCount", { count: changed.length })}
        </span>
      </div>
    </SectionCard>
  );
}
