"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDateTime } from "@/lib/format";
import { KPI_LEVEL_FIELDS, TEXTAREA_CLASS, type ComposerKpi } from "./change-request-draft";
import type { KpiVersionRow } from "./KpiVersionHistory";

/**
 * HR's side of §6.2 — reviewing a pending change request.
 *
 * Three spec points live here and nowhere else in the UI:
 *
 *  - **Only HR sees the decision controls.** §6.2 gives the decision to HR; a
 *    manager viewing their own request sees the same diff and a Withdraw button.
 *    This is an affordance, not a control — the route checks authority itself.
 *  - **A rejection reason is mandatory.** §6.2: "HR must enter a reason
 *    (mandatory field) that the manager can see." The Reject button stays
 *    disabled until there is one, the API refuses without one, and a CHECK
 *    constraint refuses it in the database. Three layers, because the manager
 *    reading "rejected" with no reason has nothing to act on.
 *  - **There is no partial approval.** The request is one act (§5.3 needs the
 *    set to stay at 100), so there is no per-edit checkbox — approving some
 *    edits and not others is exactly how a set ends up at 90%.
 *  - **The employee's acknowledgment is shown, and overriding it is explicit.**
 *    UAT Scenario C put the employee between the manager and HR, so "approve"
 *    now means two different acts: ratifying a change the employee has seen, or
 *    overriding the fact that they have not. The second needs its own written
 *    reason (§6.2), it is recorded AS an override, and it is available only
 *    while the mid-year stage is open — past the deadline the request is locked
 *    and HR cannot push it through by waiting.
 */

interface ReviewEdit {
  kpiId: string;
  description: string | null;
  weightage: string | null;
  descriptorOutstanding: string | null;
  descriptorExcellent: string | null;
  descriptorTarget: string | null;
  descriptorAlmostAchieved: string | null;
  descriptorUnsatisfactory: string | null;
}

export interface ReviewRequest {
  id: string;
  /** The column. Kept for the audit-shaped record; never the actionable test. */
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "NOT_ACKNOWLEDGED";
  /**
   * What the request IS now, derived from the clock on the server. An
   * unacknowledged request past the mid-year deadline reads `NOT_ACKNOWLEDGED`
   * here while `status` still says `PENDING`, because nothing writes at the
   * instant a deadline passes — `cycle-sweep` catches up afterwards.
   */
  effectiveStatus: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "NOT_ACKNOWLEDGED";
  rationale: string;
  requestedAt: string;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  acknowledgmentOverridden: boolean;
  overrideReason: string | null;
  edits: ReviewEdit[];
}

/** The seven §5.2 fields, in the order the spec reads them. */
const FIELDS = [
  { field: "description" as const },
  { field: "weightage" as const },
  ...KPI_LEVEL_FIELDS.map(({ field }) => ({ field })),
];

/**
 * The status pair, lifted out of the card because the card was over the
 * complexity ceiling with it inline — and because these two badges only make
 * sense read together: the status says what stage the request is at, the
 * acknowledgment says whose move it is.
 */
function RequestBadges({ request }: { request: ReviewRequest }) {
  const t = useTranslations("pms.changeRequest");
  const pending = request.effectiveStatus === "PENDING";
  const acknowledged = request.acknowledgedAt !== null;

  const statusVariant = pending
    ? "warning"
    : request.effectiveStatus === "APPROVED"
      ? "success"
      : request.effectiveStatus === "NOT_ACKNOWLEDGED"
        ? "danger"
        : "outline";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Badge variant={statusVariant}>
        {/* "Awaiting HR" is only true once the employee has acted. While it is
            still with them, saying HR is the holdup is a lie that the
            acknowledgment badge beside it immediately contradicts. */}
        {pending && !acknowledged
          ? t("statusAwaitingEmployee")
          : t(`status.${request.effectiveStatus}`)}
      </Badge>
      {/* §6.2 — the acknowledgment, beside the status, because it is the thing
          HR is now supposed to decide WITH. An overridden request says so
          permanently: "approved" and "approved without the employee" are not
          the same fact, and the history must not flatten them. */}
      {request.acknowledgmentOverridden ? (
        <Badge variant="warning">{t("ackOverridden")}</Badge>
      ) : request.acknowledgedAt ? (
        <Badge variant="success">
          {t("ackBy", {
            name: request.acknowledgedByName ?? t("unknownEmployee"),
            datetime: formatDateTime(request.acknowledgedAt),
          })}
        </Badge>
      ) : request.effectiveStatus === "NOT_ACKNOWLEDGED" ? (
        <Badge variant="danger">{t("ackMissed")}</Badge>
      ) : null}
      {/* No "awaiting the employee" badge here: in that state the status badge
          beside it already reads "Awaiting the employee's acknowledgment", and
          two badges saying one thing is how a reader learns to skip both. */}
    </div>
  );
}

export function ChangeRequestReview({
  request,
  kpis,
  versions,
  canDecide,
  canWithdraw,
  stageOpen,
  busy,
  onDecide,
  onWithdraw,
}: {
  request: ReviewRequest;
  kpis: ComposerKpi[];
  /**
   * §6.3's archive. For an APPROVED request the live KPI already holds the new
   * value, so diffing against it shows "30 → 30" and claims nothing changed —
   * the honest BEFORE is the version that request superseded, which is exactly
   * what `supersededByRequestId` records. For a rejected or withdrawn request
   * nothing was applied, so the live row IS the before.
   */
  versions: KpiVersionRow[];
  canDecide: boolean;
  canWithdraw: boolean;
  /** §6.2 — the override exists only inside the mid-year window (ADR-072). */
  stageOpen: boolean;
  busy: boolean;
  onDecide: (decision: "APPROVE" | "REJECT", reason: string, overrideReason: string) => void;
  onWithdraw: () => void;
}) {
  const t = useTranslations("pms.changeRequest");
  const [reason, setReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  // The DERIVED status decides what is actionable. Using `status` here is how a
  // locked request kept its live Approve button for as long as the sweep lagged.
  const pending = request.effectiveStatus === "PENDING";
  const acknowledged = request.acknowledgedAt !== null;
  // Approving an unacknowledged request IS the override, so the reason is
  // mandatory for it exactly as the rejection reason is for a rejection.
  const needsOverride = pending && !acknowledged;
  const canApprove = acknowledged ? true : stageOpen && overrideReason.trim() !== "";

  return (
    <SectionCard
      title={t("reviewTitle")}
      subtitle={t("requestedBy", {
        name: request.requestedByName ?? t("unknownRequester"),
        datetime: formatDateTime(request.requestedAt),
      })}
    >
      <RequestBadges request={request} />

      <p className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
        {request.rationale}
      </p>

      <div className="space-y-4">
        {request.edits.map((edit) => {
          const live = kpis.find((k) => k.id === edit.kpiId);
          const archived = versions.find(
            (v) => v.kpiId === edit.kpiId && v.supersededByRequestId === request.id,
          );
          const before = archived ?? live;
          const moved = FIELDS.filter(({ field }) => edit[field] !== null);
          return (
            <div key={edit.kpiId} className="rounded-md border border-border p-4">
              <p className="text-sm font-medium text-foreground">
                {/* A KPI withdrawn between raising and deciding has no live row.
                    Saying so is the point — approving would then apply an edit
                    to something that is gone, and the API refuses it. */}
                {live?.description ?? archived?.kpiDescription ?? t("kpiGone")}
              </p>
              <dl className="mt-3 space-y-3">
                {moved.map(({ field }) => (
                  <div key={field} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                    <dt className="text-xs font-medium text-muted-foreground">
                      {t(`field.${field}`)}
                    </dt>
                    <dd className="space-y-1 text-sm">
                      <p className="text-muted-foreground line-through">{before?.[field] ?? "—"}</p>
                      <p className="text-foreground">{edit[field]}</p>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>

      {request.decisionReason ? (
        <div className="mt-4 rounded-md border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("decisionReasonLabel")}</p>
          <p className="mt-1 text-sm text-foreground">{request.decisionReason}</p>
          {request.decidedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("decidedBy", {
                name: request.decidedByName ?? t("unknownDecider"),
                datetime: formatDateTime(request.decidedAt),
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* §6.2 — the override, recorded on the request for good. It is shown
          outside the decision block so it survives on a decided request: an
          approval made without the employee is exactly the thing they must be
          able to point at later. */}
      {request.acknowledgmentOverridden && request.overrideReason ? (
        <div className="mt-4 rounded-md border border-warning-emphasis/30 bg-warning/10 p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("overrideReasonLabel")}</p>
          <p className="mt-1 text-sm text-foreground">{request.overrideReason}</p>
        </div>
      ) : null}

      {pending && canDecide ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="cr-reason">{t("reasonLabel")}</Label>
            <textarea
              id="cr-reason"
              className={TEXTAREA_CLASS}
              placeholder={t("reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("reasonHelp")}</p>
          </div>

          {/* The override input appears ONLY when it can be acted on: the
              employee has not acknowledged AND the window is still open. Past
              the deadline the field is replaced by the reason it is gone,
              because a disabled control with no explanation reads as a bug. */}
          {needsOverride ? (
            stageOpen ? (
              <div className="space-y-1.5">
                <Label htmlFor="cr-override">{t("overrideLabel")}</Label>
                <textarea
                  id="cr-override"
                  className={TEXTAREA_CLASS}
                  placeholder={t("overridePlaceholder")}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("overrideHelp")}</p>
              </div>
            ) : (
              <p role="status" className="text-xs text-muted-foreground">
                {t("overrideClosed")}
              </p>
            )
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy || !canApprove}
              onClick={() => onDecide("APPROVE", reason.trim(), overrideReason.trim())}
            >
              {needsOverride ? t("approveWithOverride") : t("approve")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || reason.trim() === ""}
              onClick={() => onDecide("REJECT", reason.trim(), "")}
            >
              {t("reject")}
            </Button>
          </div>
        </div>
      ) : null}

      {pending && canWithdraw ? (
        <div className="mt-4 border-t border-border pt-4">
          <Button variant="outline" disabled={busy} onClick={onWithdraw}>
            {t("withdraw")}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">{t("withdrawHelp")}</p>
        </div>
      ) : null}
    </SectionCard>
  );
}
