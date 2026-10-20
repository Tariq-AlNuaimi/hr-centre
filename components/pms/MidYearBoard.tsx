"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiClient } from "@/lib/api-client";
import { useNotify } from "@/hooks/use-notify";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { StageBanner, type GoalStage } from "@/components/pms/StageBanner";
import { ChangeRequestComposer } from "@/components/pms/ChangeRequestComposer";
import { ChangeRequestReview, type ReviewRequest } from "@/components/pms/ChangeRequestReview";
import { KpiVersionHistory, type KpiVersionRow } from "@/components/pms/KpiVersionHistory";
import type { ComposerKpi, MinimalEdit } from "@/components/pms/change-request-draft";

/**
 * The mid-year workspace for one participant — spec §6.
 *
 * Composes three panels and owns the writes between them. Which panels appear
 * is decided by STATE, not by role name:
 *
 *   - a request is already pending  → the review panel (HR decides, the
 *     requester may withdraw); the composer is not offered, because §5.3 cannot
 *     evaluate two proposals against one set
 *   - no request pending            → the composer, if this actor may raise one
 *   - always                        → §6.3's archive
 *
 * The panels are affordances. Every refusal they encode is also a route check —
 * §4.2's 404, §6.2's HR-only decision, §5.4's deadline — and a 409 or 403 coming
 * back from a write is LATCHED into `serverBlocked` so the screen stops
 * offering an action the server has just refused. Same pattern as
 * `KpiDraftBoard`, and for the same reason: the page's gate was computed at
 * render time and the server's is the one that counts.
 */

export interface MidYearBoardProps {
  participantId: string;
  stage: GoalStage | null;
  kpis: ComposerKpi[];
  versions: KpiVersionRow[];
  pendingRequest: ReviewRequest | null;
  history: ReviewRequest[];
  /** Why this actor cannot raise one right now (§5.1/§5.4/§2/§8.3), or null. */
  submitBlockedReason: string | null;
  canDecide: boolean;
  canWithdraw: boolean;
  /** §6.2 — whether HR's override is still available (ADR-072). */
  stageOpen: boolean;
  goalSettingExempt: boolean;
}

export function MidYearBoard({
  participantId,
  stage,
  kpis,
  versions,
  pendingRequest,
  history,
  submitBlockedReason,
  canDecide,
  canWithdraw,
  stageOpen,
  goalSettingExempt,
}: MidYearBoardProps) {
  const t = useTranslations("pms.changeRequest");
  const router = useRouter();
  const { success, error: showError } = useNotify();

  const [busy, setBusy] = useState(false);
  const [serverBlocked, setServerBlocked] = useState<string | null>(null);

  // §8.3 — C-Level skip goal-setting entirely, so there is no baseline of theirs
  // for §6 to amend. Categorical, answered before anything else.
  if (goalSettingExempt) {
    return (
      <div className="space-y-6">
        <StageBanner stage={stage} namespace="pms.midYear.stage" />
        <SectionCard title={t("exemptTitle")}>
          <EmptyState description={t("exemptBody")} />
        </SectionCard>
      </div>
    );
  }

  /** A 409/403 is STATE the server just told us about — latch it. */
  function absorb(e: unknown, fallback: string): string {
    const message = e instanceof ApiError ? e.message : fallback;
    if (e instanceof ApiError && (e.status === 409 || e.status === 403)) setServerBlocked(message);
    return message;
  }

  async function run(work: () => Promise<void>, toast: string, fallback: string) {
    setBusy(true);
    try {
      await work();
      success(toast);
      router.refresh();
    } catch (e) {
      showError(absorb(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  const submit = (payload: { rationale: string; edits: MinimalEdit[] }) =>
    run(
      async () => {
        await apiClient.post("/api/kpi-change-requests", { participantId, ...payload });
      },
      t("submittedToast"),
      t("submitFailed"),
    );

  const decide = (decision: "APPROVE" | "REJECT", reason: string, overrideReason: string) =>
    run(
      async () => {
        await apiClient.post(`/api/kpi-change-requests/${pendingRequest!.id}/decide`, {
          decision,
          // An empty approval note is ABSENT, not blank: the column is nullable
          // and "" would read as a reason nobody wrote. A rejection cannot reach
          // here empty — the button is disabled and the API refuses it.
          ...(reason === "" ? {} : { reason }),
          // §6.2's override reason is a SEPARATE field from the decision note,
          // for the reason the schema keeps them apart: one column answering two
          // mandatory-reason rules can be validated for neither. Sent only when
          // there is one; the API decides whether it was needed.
          ...(overrideReason === "" ? {} : { overrideReason }),
        });
      },
      decision === "APPROVE" ? t("approvedToast") : t("rejectedToast"),
      t("decideFailed"),
    );

  const withdraw = () =>
    run(
      async () => {
        await apiClient.post(`/api/kpi-change-requests/${pendingRequest!.id}/withdraw`);
      },
      t("withdrawnToast"),
      t("withdrawFailed"),
    );

  return (
    <div className="space-y-6">
      <StageBanner stage={stage} namespace="pms.midYear.stage" />

      {pendingRequest ? (
        <ChangeRequestReview
          request={pendingRequest}
          kpis={kpis}
          versions={versions}
          canDecide={canDecide && serverBlocked === null}
          canWithdraw={canWithdraw && serverBlocked === null}
          stageOpen={stageOpen}
          busy={busy}
          onDecide={decide}
          onWithdraw={withdraw}
        />
      ) : (
        <ChangeRequestComposer
          kpis={kpis}
          submitting={busy}
          blockedReason={serverBlocked ?? submitBlockedReason}
          onSubmit={submit}
        />
      )}

      {/* Decided and withdrawn requests, newest first. §6.3 wants the history of
          what was ASKED, not only of what was approved — a withdrawn proposal
          stays on the record. */}
      {history.length > 0 ? (
        <SectionCard title={t("decidedTitle")} subtitle={t("decidedSubtitle")}>
          <div className="space-y-4">
            {history.map((request) => (
              <ChangeRequestReview
                key={request.id}
                request={request}
                kpis={kpis}
                versions={versions}
                canDecide={false}
                canWithdraw={false}
                stageOpen={stageOpen}
                busy={busy}
                onDecide={() => {}}
                onWithdraw={() => {}}
              />
            ))}
          </div>
        </SectionCard>
      ) : null}

      <KpiVersionHistory versions={versions} />
    </div>
  );
}
