"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBand, formatMoney } from "@/lib/hiring/money";
import {
  composeDecisionNote,
  DECISION_TARGET,
  type RequisitionDecision,
} from "@/lib/hiring/requisition-rules";
import { useHiringMe, useHiringMutation, useHiringQuery } from "../ui/api";
import { StatusBadge } from "../ui/badges";
import { Field, Textarea } from "@/components/shared/FormControls";
import { Notice, QueryState } from "../ui/states";
import type { RequisitionDetail } from "./types";

/**
 * Step 2 — headcount & budget approval (Interview Hub `RequisitionApprovalClient`,
 * artboards T02/T03/T04/T22). HR Manager then Operations Director; the server
 * enforces routing and separation of duties, this screen explains them.
 */
type Approval = {
  status: string;
  steps: {
    sequence: number;
    role: string;
    approvers: { id: string; name: string }[];
    signedBy: { name: string } | null;
    signedAt: string | null;
    comment: string | null;
    isNext: boolean;
  }[];
  submittedBy: { id: string; name: string } | null;
  submittedAt: string | null;
  budget: {
    openings: number;
    annualisedOMR: number | null;
    envelope: { fiscalYear: string; amountOMR: number; setBy: string; setOn: string } | null;
    remainingOMR: number | null;
    overEnvelope: boolean;
  } | null;
  band: { salaryBandMin: number | null; salaryBandMax: number | null; bandHidden: boolean };
  lastDecision: {
    decision: string | null;
    note: string;
    toStatus: string;
    at: string;
    by: { name: string } | null;
  } | null;
  can: { decide: boolean; decideRefusal: string | null; withdraw: boolean };
};

export function ApprovalView({ id }: { id: string }) {
  const t = useTranslations("hiring.approval");
  const { me } = useHiringMe();
  const req = useHiringQuery<RequisitionDetail>(`/api/hiring/requisitions/${id}`);
  const view = useHiringQuery<Approval>(`/api/hiring/requisitions/${id}/approval`);
  const [decision, setDecision] = useState<RequisitionDecision | "WITHDRAW" | null>(null);
  const [note, setNote] = useState("");
  const decide = useHiringMutation<object, { approvalStep?: { next: string | null } }>(
    "PATCH",
    `/api/hiring/requisitions/${id}/status`,
    { success: t("recorded"), onSuccess: () => setDecision(null) },
  );
  const r = req.data;
  const v = view.data;
  const submit = () => {
    if (decision === "WITHDRAW") {
      decide.mutate({ status: "ARCHIVED", reason: `Withdrawn — ${note.trim()}` });
    } else if (decision) {
      decide.mutate({
        status: DECISION_TARGET[decision],
        reason: composeDecisionNote(decision, note),
      });
    }
  };
  return (
    <QueryState isLoading={req.isLoading || view.isLoading} error={req.error ?? view.error}>
      {r && v ? (
        <div className="space-y-4">
          <PageHeader
            title={t("title", { title: r.title })}
            subtitle={t("subtitle", {
              department: r.departmentName ?? "—",
              entity: r.entity?.name ?? "—",
              openings: r.openings,
            })}
            actions={<StatusBadge kind="requisition" value={r.status} />}
          />
          <DecisionBanner v={v} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <ChainCard v={v} userId={me?.userId} />
              <SectionCard title={t("validatedTitle")}>
                <DescriptionList
                  columns={1}
                  items={[
                    { key: "by", label: t("raisedBy"), value: v.submittedBy?.name ?? "—" },
                    {
                      key: "need",
                      label: t("businessNeed"),
                      value: (
                        <span className="whitespace-pre-wrap">{r.businessNeed || t("notSet")}</span>
                      ),
                    },
                    {
                      key: "alt",
                      label: t("alternatives"),
                      value: (
                        <span className="whitespace-pre-wrap">
                          {r.alternativesConsidered || t("notSet")}
                        </span>
                      ),
                    },
                  ]}
                />
              </SectionCard>
              <BudgetCard r={r} v={v} />
              <SectionCard title={t("sodTitle")}>
                <p className="text-sm text-foreground">
                  {t("sodBody", { name: v.submittedBy?.name ?? "—" })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t("sodServer")}</p>
              </SectionCard>
            </div>
            <div className="space-y-4">
              <DecideCard v={v} onDecide={setDecision} />
              <SectionCard title={t("whereTitle")}>
                <DescriptionList
                  columns={1}
                  items={[
                    {
                      key: "s",
                      label: t("status"),
                      value: <StatusBadge kind="requisition" value={v.status} />,
                    },
                    {
                      key: "since",
                      label: t("submitted"),
                      value: v.submittedAt ? formatDate(v.submittedAt) : "—",
                    },
                    {
                      key: "close",
                      label: t("targetClose"),
                      value: r.targetCloseDate ? formatDate(r.targetCloseDate) : "—",
                    },
                  ]}
                />
              </SectionCard>
            </div>
          </div>
          <Dialog open={decision !== null} onOpenChange={(o) => !o && setDecision(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{decision ? t(`dialog.${decision}`) : ""}</DialogTitle>
              </DialogHeader>
              <Field label={t("decisionNote")} htmlFor="ap-note" hint={t("decisionNoteHint")}>
                <Textarea id="ap-note" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDecision(null)}>
                  {t("cancel")}
                </Button>
                <Button disabled={!note.trim() || decide.isPending} onClick={submit}>
                  {t("confirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </QueryState>
  );
}

function BudgetCard({ r, v }: { r: RequisitionDetail; v: Approval }) {
  const t = useTranslations("hiring.approval");
  if (!v.budget) {
    return (
      <SectionCard title={t("budgetTitle")}>
        <p className="text-sm text-muted-foreground">{t("budgetHidden")}</p>
      </SectionCard>
    );
  }
  const b = v.budget;
  return (
    <SectionCard title={t("budgetTitle")} subtitle={t("budgetHint")}>
      <DescriptionList
        columns={2}
        items={[
          {
            key: "band",
            label: t("band"),
            value: formatBand(v.band.salaryBandMin, v.band.salaryBandMax, r.salaryCurrency),
          },
          { key: "grade", label: t("grade"), value: r.grade ?? "—" },
          { key: "open", label: t("openings"), value: String(b.openings) },
          { key: "ann", label: t("annualised"), value: formatMoney(b.annualisedOMR) },
          {
            key: "env",
            label: t("envelope"),
            value: b.envelope
              ? t("envelopeValue", {
                  amount: formatMoney(b.envelope.amountOMR),
                  fy: b.envelope.fiscalYear,
                  by: b.envelope.setBy,
                })
              : t("noEnvelope"),
          },
          { key: "rem", label: t("remaining"), value: formatMoney(b.remainingOMR) },
        ]}
      />
      {b.overEnvelope ? (
        <div className="mt-3">
          <Notice tone="warning">{t("overEnvelope")}</Notice>
        </div>
      ) : null}
    </SectionCard>
  );
}

function ChainCard({ v, userId }: { v: Approval; userId?: string }) {
  const t = useTranslations("hiring.approval");
  const tr = useTranslations("hiring.roles");
  const me = { userId };
  return (
    <SectionCard title={t("chainTitle")} subtitle={t("chainHint")}>
      <ol className="space-y-3">
        {v.steps.map((s) => (
          <li key={s.sequence} className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium text-foreground">
              {s.sequence}. {tr(s.role)}
            </p>
            {s.signedBy ? (
              <p className="text-status-ok-fg">
                {t("signedBy", {
                  name: s.signedBy.name,
                  date: s.signedAt ? formatDateTime(s.signedAt) : "",
                })}
              </p>
            ) : s.approvers.length === 0 ? (
              <p className="text-destructive-emphasis">{t("vacant")}</p>
            ) : (
              <p className="text-muted-foreground">
                {s.approvers.map((a) => a.name).join(", ")}
                {s.isNext && s.approvers.some((a) => a.id === me?.userId)
                  ? ` · ${t("awaitingYou")}`
                  : ""}
              </p>
            )}
            {s.comment ? (
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{s.comment}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

function DecideCard({
  v,
  onDecide,
}: {
  v: Approval;
  onDecide: (d: RequisitionDecision | "WITHDRAW") => void;
}) {
  const t = useTranslations("hiring.approval");
  const setDecision = onDecide;
  return (
    <SectionCard title={t("decideTitle")}>
      {v.can.decide ? (
        <div className="flex flex-col gap-2">
          <Button onClick={() => setDecision("APPROVE")}>{t("approve")}</Button>
          <Button variant="outline" onClick={() => setDecision("SEND_BACK")}>
            {t("sendBack")}
          </Button>
          <Button variant="destructive" onClick={() => setDecision("REJECT")}>
            {t("reject")}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{v.can.decideRefusal ?? t("cannotDecide")}</p>
      )}
      {v.can.withdraw && v.status === "PENDING_APPROVAL" ? (
        <Button variant="ghost" className="mt-3" onClick={() => setDecision("WITHDRAW")}>
          {t("withdraw")}
        </Button>
      ) : null}
    </SectionCard>
  );
}

function DecisionBanner({ v }: { v: Approval }) {
  const t = useTranslations("hiring.approval");
  return (
    <>
      {v.status === "DRAFT" && v.lastDecision?.decision ? (
        <Notice
          tone={v.lastDecision.decision === "REJECT" ? "danger" : "warning"}
          title={t(`banner.${v.lastDecision.decision}`, { by: v.lastDecision.by?.name ?? "—" })}
        >
          <p className="whitespace-pre-wrap">{v.lastDecision.note}</p>
          <p className="mt-1">{t("resubmitNote")}</p>
        </Notice>
      ) : null}
    </>
  );
}
