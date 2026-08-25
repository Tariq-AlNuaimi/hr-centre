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
 */

export interface ReviewEdit {
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
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  rationale: string;
  requestedAt: string;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  edits: ReviewEdit[];
}

/** The seven §5.2 fields, in the order the spec reads them. */
const FIELDS = [
  { field: "description" as const },
  { field: "weightage" as const },
  ...KPI_LEVEL_FIELDS.map(({ field }) => ({ field })),
];

export function ChangeRequestReview({
  request,
  kpis,
  versions,
  canDecide,
  canWithdraw,
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
  busy: boolean;
  onDecide: (decision: "APPROVE" | "REJECT", reason: string) => void;
  onWithdraw: () => void;
}) {
  const t = useTranslations("pms.changeRequest");
  const [reason, setReason] = useState("");

  const pending = request.status === "PENDING";

  return (
    <SectionCard
      title={t("reviewTitle")}
      subtitle={t("requestedBy", {
        name: request.requestedByName ?? t("unknownRequester"),
        datetime: formatDateTime(request.requestedAt),
      })}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge
          variant={pending ? "warning" : request.status === "APPROVED" ? "success" : "outline"}
        >
          {t(`status.${request.status}`)}
        </Badge>
      </div>

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
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => onDecide("APPROVE", reason.trim())}>
              {t("approve")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || reason.trim() === ""}
              onClick={() => onDecide("REJECT", reason.trim())}
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
