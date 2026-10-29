"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, CircleDashed, Clock, Undo2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDateTime } from "@/lib/format";
import { useHiringMutation, useHiringQuery } from "../ui/api";
import { Field, Textarea } from "@/components/shared/FormControls";
import { Notice, QueryState } from "../ui/states";
import type { ApprovalViewData, ChainStepView } from "./types";

type Action = "APPROVED" | "REJECTED" | "SENT_BACK";

/** The approval chain (Interview Hub `OfferApprovalTimeline` + `BeforeYouApprove`) and the decision. */
export function ApprovalPanel({ offerId }: { offerId: string }) {
  const t = useTranslations("hiring.offerApproval");
  const q = useHiringQuery<ApprovalViewData>(`/api/hiring/offers/${offerId}/approvals`);
  const [action, setAction] = useState<Action | null>(null);
  const v = q.data;
  const recused = v?.chain.filter((s) => s.recused) ?? [];
  return (
    <div className="space-y-4">
      <SectionCard title={t("title")} subtitle={v?.preview ? t("previewHint") : undefined}>
        <QueryState
          isLoading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rows={3}
        >
          {v ? (
            <div className="space-y-4">
              {recused.length ? <RecusedNotice steps={recused} /> : null}
              <Timeline chain={v.chain} />
              {v.status === "PENDING_APPROVAL" ? <Decide v={v} onPick={setAction} /> : null}
            </div>
          ) : null}
        </QueryState>
      </SectionCard>
      {v?.status === "PENDING_APPROVAL" ? <BeforeYouApprove v={v} /> : null}
      {action ? (
        <DecideDialog offerId={offerId} action={action} onClose={() => setAction(null)} />
      ) : null}
    </div>
  );
}

function RecusedNotice({ steps }: { steps: ChainStepView[] }) {
  const t = useTranslations("hiring.offerApproval");
  const tr = useTranslations("hiring.roles");
  return (
    <Notice
      tone="warning"
      title={t("recusedTitle", { roles: steps.map((s) => tr(s.role)).join(" / ") })}
    >
      {t("recusedBody")}
    </Notice>
  );
}

const STATE_ICON = {
  APPROVED: Check,
  REJECTED: X,
  SENT_BACK: Undo2,
  AWAITING: Clock,
  PENDING: CircleDashed,
} as const;

function Timeline({ chain }: { chain: ChainStepView[] }) {
  const t = useTranslations("hiring.offerApproval");
  const tr = useTranslations("hiring.roles");
  if (chain.length === 0) return <p className="text-sm text-muted-foreground">{t("noChain")}</p>;
  return (
    <ol className="space-y-3">
      {chain.map((s) => {
        const Icon = STATE_ICON[s.state];
        return (
          <li key={s.sequence} className="flex gap-3">
            <span
              className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted"
              aria-hidden
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{tr(s.role)}</span>
                <Badge
                  variant={
                    s.state === "APPROVED"
                      ? "success"
                      : s.state === "AWAITING"
                        ? "warning"
                        : s.state === "PENDING"
                          ? "outline"
                          : "danger"
                  }
                >
                  {t(`state.${s.state}`)}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {s.decidedBy
                  ? t("decidedBy", {
                      name: s.decidedBy,
                      when: s.decidedAt ? formatDateTime(s.decidedAt) : "—",
                    })
                  : s.approvers.length
                    ? t("assignedTo", { names: s.approvers.map((a) => a.name).join(", ") })
                    : s.recused
                      ? t("recusedStep")
                      : t("noHolder")}
              </p>
              {s.comment ? <p className="mt-1 whitespace-pre-wrap">{s.comment}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Decide({ v, onPick }: { v: ApprovalViewData; onPick: (a: Action) => void }) {
  const t = useTranslations("hiring.offerApproval");
  if (!v.canDecide) {
    return v.refusal ? <p className="text-xs text-muted-foreground">{v.refusal}</p> : null;
  }
  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
      <Button onClick={() => onPick("APPROVED")}>
        <Check className="h-4 w-4" />
        {t("approve")}
      </Button>
      <Button variant="outline" onClick={() => onPick("SENT_BACK")}>
        <Undo2 className="h-4 w-4" />
        {t("sendBack")}
      </Button>
      <Button variant="outline" onClick={() => onPick("REJECTED")}>
        <X className="h-4 w-4" />
        {t("reject")}
      </Button>
    </div>
  );
}

function BeforeYouApprove({ v }: { v: ApprovalViewData }) {
  const t = useTranslations("hiring.offerApproval");
  const pkg = v.checklist.packageConfirmed;
  const pkgOk = pkg === "CONFIRMED" || pkg === "DECLINED";
  const band = v.checklist.band;
  const items = [
    { k: "package", ok: pkgOk, text: pkgOk ? t(`check.package.${pkg}`) : t("check.package.open") },
    {
      k: "band",
      ok: band === "WITHIN",
      text: band ? t(`check.band.${band}`) : t("check.band.hidden"),
    },
    { k: "terms", ok: true, text: t("check.terms") },
    {
      k: "sod",
      ok: !v.submittedByYou,
      text: v.submittedByYou
        ? t("check.sodYou")
        : t("check.sodOther", { name: v.submittedBy ?? "—" }),
    },
  ];
  return (
    <SectionCard title={t("beforeTitle")} subtitle={t("beforeHint")}>
      <ul className="space-y-2 text-sm">
        {items.map((i) => (
          <li key={i.k} className="flex gap-2">
            {i.ok ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-status-ok-fg" aria-label={t("ok")} />
            ) : (
              <CircleDashed
                className="mt-0.5 h-4 w-4 shrink-0 text-status-warn-fg"
                aria-label={t("needsAttention")}
              />
            )}
            <span>{i.text}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function DecideDialog({
  offerId,
  action,
  onClose,
}: {
  offerId: string;
  action: Action;
  onClose: () => void;
}) {
  const t = useTranslations("hiring.offerApproval");
  const [comment, setComment] = useState("");
  const decide = useHiringMutation<{ action: Action; comment?: string }>(
    "POST",
    `/api/hiring/offers/${offerId}/approvals`,
    {
      success: t(`decided.${action}`),
      onSuccess: onClose,
    },
  );
  const needsWhy = action !== "APPROVED";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`dialog.${action}`)}</DialogTitle>
          <DialogDescription>
            {action === "APPROVED" ? t("approveHint") : t("backHint")}
          </DialogDescription>
        </DialogHeader>
        <Field label={needsWhy ? t("why") : t("comment")} htmlFor="od-comment" required={needsWhy}>
          <Textarea
            id="od-comment"
            rows={3}
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant={action === "REJECTED" ? "destructive" : "default"}
            disabled={decide.isPending || (needsWhy && !comment.trim())}
            onClick={() => decide.mutate({ action, comment: comment.trim() || undefined })}
          >
            {t(`confirm.${action}`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
