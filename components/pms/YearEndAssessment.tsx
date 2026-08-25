"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiClient } from "@/lib/api-client";
import { useNotify } from "@/hooks/use-notify";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StageBanner, type GoalStage } from "@/components/pms/StageBanner";
import { TEXTAREA_CLASS } from "@/components/pms/change-request-draft";
import { formatDateTime } from "@/lib/format";

/**
 * §7.1 — the year-end assessment, from both sides of it.
 *
 * "Employee self-assesses against each KPI, using the five-level descriptors
 * defined at goal-setting → manager reviews → offline discussion → both sign off
 * on the final ratings."
 *
 * ## The descriptors are the interface
 *
 * §7.1 is explicit that the assessment is made "using the five-level descriptors
 * defined at goal-setting", so this screen shows the five sentences the manager
 * actually wrote for THIS KPI and asks which one describes the year. It never
 * shows a bare 1–5 scale: the numbers are §8.1's scoring representation, not the
 * question a person is being asked.
 *
 * ## Two behaviours that are NOT in §7
 *
 * Recorded as operator decisions so a later reader does not mistake them for
 * the specification:
 *
 *  - the manager SEES the employee's self-assessment while reviewing
 *  - a manager who picks a DIFFERENT level must say why, in either direction
 *
 * The comment box appears the moment the selection diverges, rather than after a
 * failed submit, because a rule discovered by rejection reads as an obstacle and
 * a rule stated up front reads as the point.
 */

export interface YearEndKpi {
  id: string;
  description: string;
  weightage: string;
  levels: { level: number; text: string }[];
  employeeRating: { level: number; comment: string | null; ratedAt: string } | null;
  managerRating: { level: number; comment: string | null; ratedAt: string } | null;
}

export interface YearEndSetState {
  kpiCount: number;
  employeeRated: number;
  managerRated: number;
  complete: boolean;
  divergentKpiIds: string[];
}

export function YearEndAssessment({
  participantId,
  stage,
  kpis,
  initialState,
  /** Which side the viewer is acting as; null when they may only look on. */
  actingAs,
  signedParties,
  goalSettingExempt,
  blockedReason,
}: {
  participantId: string;
  stage: GoalStage | null;
  kpis: YearEndKpi[];
  initialState: YearEndSetState;
  actingAs: "EMPLOYEE" | "MANAGER" | null;
  signedParties: ("EMPLOYEE" | "MANAGER")[];
  goalSettingExempt: boolean;
  blockedReason: string | null;
}) {
  const t = useTranslations("pms.yearEnd");
  const router = useRouter();
  const { success, error: showError } = useNotify();

  const [busy, setBusy] = useState<string | null>(null);
  const [serverBlocked, setServerBlocked] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { level: number; comment: string }>>({});

  // §8.3 — C-Level skip self-assessment entirely; their score passes through
  // from the entity. Categorical, so it is answered before anything else.
  if (goalSettingExempt) {
    return (
      <div className="space-y-6">
        <StageBanner stage={stage} namespace="pms.yearEnd.stage" />
        <SectionCard title={t("exemptTitle")}>
          <EmptyState description={t("exemptBody")} />
        </SectionCard>
      </div>
    );
  }

  const blocked = serverBlocked ?? blockedReason;
  const canAct = actingAs !== null && blocked === null && !signedParties.includes(actingAs);

  const ratingOf = (kpi: YearEndKpi) =>
    actingAs === "MANAGER" ? kpi.managerRating : kpi.employeeRating;

  const draftFor = (kpi: YearEndKpi) =>
    drafts[kpi.id] ?? {
      level: ratingOf(kpi)?.level ?? 0,
      comment: ratingOf(kpi)?.comment ?? "",
    };

  /** The operator's divergence rule, mirrored client-side so it is visible early. */
  const divergesFrom = (kpi: YearEndKpi, level: number) =>
    actingAs === "MANAGER" &&
    kpi.employeeRating !== null &&
    level !== 0 &&
    level !== kpi.employeeRating.level;

  function absorb(e: unknown, fallback: string): string {
    const message = e instanceof ApiError ? e.message : fallback;
    if (e instanceof ApiError && (e.status === 409 || e.status === 403)) setServerBlocked(message);
    return message;
  }

  async function saveRating(kpi: YearEndKpi) {
    const draft = draftFor(kpi);
    setBusy(kpi.id);
    try {
      await apiClient.post("/api/kpi-ratings", {
        kpiId: kpi.id,
        party: actingAs,
        level: draft.level,
        ...(draft.comment.trim() === "" ? {} : { comment: draft.comment.trim() }),
      });
      success(t("ratingSaved"));
      router.refresh();
    } catch (e) {
      showError(absorb(e, t("ratingFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function signOff() {
    setBusy("sign");
    try {
      await apiClient.post("/api/year-end-signoffs", { participantId, party: actingAs });
      success(t("signed"));
      router.refresh();
    } catch (e) {
      showError(absorb(e, t("signFailed")));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <StageBanner stage={stage} namespace="pms.yearEnd.stage" />

      {blocked ? (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {blocked}
        </p>
      ) : null}

      <SectionCard title={t("progressTitle")} subtitle={t("progressSubtitle")}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={initialState.employeeRated === initialState.kpiCount ? "success" : "outline"}
          >
            {t("selfProgress", { done: initialState.employeeRated, total: initialState.kpiCount })}
          </Badge>
          <Badge
            variant={initialState.managerRated === initialState.kpiCount ? "success" : "outline"}
          >
            {t("managerProgress", {
              done: initialState.managerRated,
              total: initialState.kpiCount,
            })}
          </Badge>
          {initialState.divergentKpiIds.length > 0 ? (
            <Badge variant="warning">
              {t("divergentCount", { count: initialState.divergentKpiIds.length })}
            </Badge>
          ) : null}
        </div>
      </SectionCard>

      {kpis.map((kpi) => {
        const draft = draftFor(kpi);
        const diverges = divergesFrom(kpi, draft.level);
        const needsComment = diverges && draft.comment.trim() === "";
        return (
          <SectionCard
            key={kpi.id}
            title={kpi.description}
            subtitle={t("weightage", { value: kpi.weightage })}
          >
            {/* The manager sees what the employee said, before choosing. An
                operator decision, not §7 — see the file header. */}
            {actingAs === "MANAGER" && kpi.employeeRating ? (
              <div className="mb-4 rounded-md border border-border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">{t("selfAssessment")}</p>
                <p className="mt-1 text-sm text-foreground">
                  {kpi.levels.find((l) => l.level === kpi.employeeRating!.level)?.text ?? "—"}
                </p>
                {kpi.employeeRating.comment ? (
                  <p className="mt-1 text-sm text-muted-foreground">{kpi.employeeRating.comment}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("ratedAt", { datetime: formatDateTime(kpi.employeeRating.ratedAt) })}
                </p>
              </div>
            ) : null}

            {/* §7.1 — the five descriptors the manager authored, not a bare 1–5. */}
            <fieldset disabled={!canAct} className="space-y-2">
              <legend className="sr-only">{t("chooseLevel")}</legend>
              {kpi.levels.map(({ level, text }) => (
                <label
                  key={level}
                  htmlFor={`level-${kpi.id}-${level}`}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-primary has-[:disabled]:cursor-not-allowed"
                >
                  <input
                    id={`level-${kpi.id}-${level}`}
                    type="radio"
                    name={`level-${kpi.id}`}
                    value={level}
                    // The level NAME plus the sentence the manager wrote, so a
                    // screen reader announces the choice being made rather than
                    // an unlabelled radio in a group of five.
                    aria-label={`${t(`levelName.${level}`)}: ${text}`}
                    checked={draft.level === level}
                    onChange={() => setDrafts((d) => ({ ...d, [kpi.id]: { ...draft, level } }))}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">{text}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`levelName.${level}`)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {actingAs !== null ? (
              <div className="mt-4 space-y-1.5">
                <Label htmlFor={`c-${kpi.id}`}>
                  {diverges ? t("reasonRequired") : t("commentOptional")}
                </Label>
                <textarea
                  id={`c-${kpi.id}`}
                  className={TEXTAREA_CLASS}
                  value={draft.comment}
                  disabled={!canAct}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [kpi.id]: { ...draft, comment: e.target.value } }))
                  }
                />
                {diverges ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t("divergenceHelp", { employeeLevel: kpi.employeeRating?.level ?? 0 })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {canAct ? (
              <div className="mt-4">
                <Button
                  disabled={draft.level === 0 || needsComment || busy === kpi.id}
                  onClick={() => saveRating(kpi)}
                >
                  {busy === kpi.id ? t("saving") : t("saveRating")}
                </Button>
              </div>
            ) : null}
          </SectionCard>
        );
      })}

      <SectionCard title={t("signTitle")} subtitle={t("signSubtitle")}>
        <div className="space-y-3">
          {(["EMPLOYEE", "MANAGER"] as const).map((party) => (
            <div key={party} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t(`party.${party}`)}</p>
                {/* Unsigned is STATED, never a missing row — §5.3's rule, which
                    §7.1 inherits: there is no reject, so silence is the signal. */}
                <p className="text-xs text-muted-foreground">
                  {signedParties.includes(party) ? t("hasSigned") : t("notSigned")}
                </p>
              </div>
              {actingAs === party && !signedParties.includes(party) ? (
                <Button
                  variant="outline"
                  disabled={!initialState.complete || blocked !== null || busy === "sign"}
                  onClick={signOff}
                >
                  {t("sign")}
                </Button>
              ) : null}
            </div>
          ))}
          {!initialState.complete ? (
            <p className="text-xs text-muted-foreground">{t("signBlocked")}</p>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
