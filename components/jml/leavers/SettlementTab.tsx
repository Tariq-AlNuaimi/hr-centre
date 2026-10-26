"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { ActionDialog } from "../ActionDialog";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock } from "../States";
import { useJmlAction } from "../use-jml";
import { SettlementLineDialog } from "./SettlementLineDialog";

type Figures = Record<string, number | string>;
export type Settlement = {
  applicable: boolean;
  calculatedAt: string | null;
  provisional: boolean;
  unverifiedKeys: string[];
  recalculationRequired: boolean;
  hireDate: string | null;
  signatureReference: string | null;
  approvedAt: string | null;
  paymentDate: string | null;
  paymentReference: string | null;
  paymentConfirmedAt: string | null;
  paymentDeadline: string | null;
  signatures: { granted: boolean; missingHolders: string[] };
  figures: Figures | null;
  lines: Array<{
    id: string;
    lineType: string;
    deductionType: string | null;
    description: string;
    lineAmount?: string | null;
    reasonCode: string;
    documentaryReference: string;
    authorisedBy: { name: string | null } | null;
  }>;
  can: { seeMoney: boolean; manage: boolean; approve: boolean };
};

const day = (v: string | null) => (v ? v.slice(0, 10) : null);

/** The final settlement (§16.1): gratuity split, leave, lines, two signatures, payment. */
export function SettlementTab({ caseId }: { caseId: string }) {
  const t = useTranslations("jml.leavers.settlement");
  const q = useQuery({
    queryKey: ["jml", "exit", caseId, "settlement"],
    queryFn: () => apiClient.get<Settlement>(`/api/jml/leavers/${caseId}/settlement`),
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <LoadFailed />;
  const s = q.data;
  if (!s.applicable) return <p className="text-sm text-muted-foreground">{t("notApplicable")}</p>;
  return (
    <div className="space-y-6">
      <StatusLine s={s} />
      <FiguresCard caseId={caseId} s={s} />
      <SectionCard
        title={t("linesTitle")}
        actions={
          s.can.manage && s.calculatedAt && !s.approvedAt ? (
            <SettlementLineDialog caseId={caseId} />
          ) : null
        }
      >
        <LinesList caseId={caseId} s={s} />
      </SectionCard>
      <ApprovalCard caseId={caseId} s={s} />
    </div>
  );
}

function statusText(s: Settlement, t: (k: string, v?: Record<string, string>) => string) {
  if (s.paymentConfirmedAt) return t("statusPaid", { date: day(s.paymentDate) ?? "" });
  if (s.approvedAt) return t("statusApproved", { date: day(s.approvedAt) ?? "" });
  if (!s.calculatedAt) return t("statusNone");
  return s.provisional
    ? t("statusProvisional", { keys: s.unverifiedKeys.join(", ") })
    : t("statusCalculated");
}

function StatusLine({ s }: { s: Settlement }) {
  const t = useTranslations("jml.leavers.settlement");
  const warn = s.provisional && s.calculatedAt && !s.approvedAt;
  return (
    <p
      role="status"
      className={
        warn
          ? "rounded-md bg-status-warn p-3 text-sm text-status-warn-fg"
          : "text-sm text-muted-foreground"
      }
    >
      {statusText(s, t)}
      {s.recalculationRequired ? ` ${t("recalcNeeded")}` : ""}
    </p>
  );
}

function FiguresCard({ caseId, s }: { caseId: string; s: Settlement }) {
  const t = useTranslations("jml.leavers.settlement");
  return (
    <SectionCard
      title={t("figuresTitle")}
      actions={
        s.can.manage && !s.approvedAt ? (
          <CalculateDialog caseId={caseId} again={Boolean(s.calculatedAt)} />
        ) : null
      }
    >
      {s.figures ? (
        <FiguresList f={s.figures} hireDate={s.hireDate} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {s.can.seeMoney ? t("notCalculated") : t("hidden")}
        </p>
      )}
    </SectionCard>
  );
}

function ApprovalCard({ caseId, s }: { caseId: string; s: Settlement }) {
  const t = useTranslations("jml.leavers.settlement");
  return (
    <SectionCard
      title={t("approvalTitle")}
      subtitle={
        s.signatures.granted
          ? t("signed")
          : t("unsigned", { who: s.signatures.missingHolders.join(", ") })
      }
    >
      <div className="flex flex-wrap gap-2">
        {s.can.approve && s.calculatedAt && !s.approvedAt ? (
          <ApproveDialog caseId={caseId} />
        ) : null}
        {s.can.manage && s.approvedAt && !s.paymentConfirmedAt ? (
          <PaymentDialog caseId={caseId} deadline={day(s.paymentDeadline)} />
        ) : null}
        {s.paymentConfirmedAt ? (
          <p className="text-sm">
            {t("paidLine", {
              date: day(s.paymentDate) ?? "",
              ref: s.paymentReference ?? "",
              deadline: day(s.paymentDeadline) ?? "—",
            })}
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}

function FiguresList({ f, hireDate }: { f: Figures; hireDate: string | null }) {
  const t = useTranslations("jml.leavers.settlement");
  const omr = (v: number | string) => t("omr", { value: Number(v).toFixed(3) });
  return (
    <DescriptionList
      columns={2}
      items={[
        { key: "hire", label: t("hireDate"), value: day(hireDate) ?? "—" },
        { key: "basic", label: t("basic"), value: omr(f.basicMonthly!) },
        {
          key: "service",
          label: t("serviceDays"),
          value: t("serviceSplit", {
            total: f.serviceDays!,
            pre: f.preSplitDays!,
            post: f.postSplitDays!,
          }),
        },
        { key: "pre", label: t("preSplit"), value: omr(f.gratuityPreSplitAmount!) },
        { key: "post", label: t("postSplit"), value: omr(f.gratuityPostSplitAmount!) },
        { key: "grat", label: t("gratuityTotal"), value: omr(f.gratuityTotal!) },
        {
          key: "leave",
          label: t("leave", { days: f.leaveBalanceDays! }),
          value:
            f.leaveOutcome === "DEDUCTION"
              ? t("leaveDeduction", { amount: Number(f.leaveDeductionAmount).toFixed(3) })
              : omr(f.leaveEncashmentAmount!),
        },
        { key: "salary", label: t("outstandingSalary"), value: omr(f.outstandingSalaryAmount!) },
        { key: "gross", label: t("gross"), value: omr(f.grossTotalAmount!) },
        { key: "adds", label: t("additions"), value: omr(f.additionsTotal!) },
        { key: "deds", label: t("deductions"), value: omr(f.deductionsTotal!) },
        { key: "net", label: t("net"), value: omr(f.netTotalAmount!) },
      ]}
    />
  );
}

function LinesList({ caseId, s }: { caseId: string; s: Settlement }) {
  const t = useTranslations("jml.leavers.settlement");
  const { run, busy } = useJmlAction(t("failed"));
  if (s.lines.length === 0) return <p className="text-sm text-muted-foreground">{t("noLines")}</p>;
  return (
    <ul className="space-y-2">
      {s.lines.map((l) => (
        <li
          key={l.id}
          className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-2 text-sm"
        >
          <div>
            <p className="font-medium">
              {t(`lineType.${l.lineType}`)} · {l.description}
              {s.can.seeMoney && l.lineAmount
                ? ` · ${t("omr", { value: Number(l.lineAmount).toFixed(3) })}`
                : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("lineMeta", {
                reason: l.reasonCode,
                ref: l.documentaryReference,
                by: l.authorisedBy?.name ?? "—",
              })}
            </p>
          </div>
          {s.can.manage && !s.approvedAt ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(
                  () => apiClient.delete(`/api/jml/leavers/${caseId}/settlement/lines/${l.id}`),
                  t("lineRemoved"),
                )
              }
            >
              {t("remove")}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CalculateDialog({ caseId, again }: { caseId: string; again: boolean }) {
  const t = useTranslations("jml.leavers.settlement");
  const { run, busy } = useJmlAction(t("failed"));
  const [leave, setLeave] = useState("0");
  const [salary, setSalary] = useState("0");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="outline">
          {again ? t("recalculate") : t("calculate")}
        </Button>
      }
      title={t("calculateTitle")}
      description={t("calculateBody")}
      confirmLabel={t("calculate")}
      busy={busy}
      disabled={leave === "" || Number.isNaN(Number(leave))}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.post(`/api/jml/leavers/${caseId}/settlement`, {
                leaveBalanceDays: Number(leave),
                outstandingSalaryAmount: Number(salary || 0),
              }),
            t("calculated"),
          ),
        )
      }
    >
      <Field id="calc-leave" label={t("leaveBalance")} hint={t("leaveBalanceHint")}>
        <Input
          id="calc-leave"
          type="number"
          step="0.5"
          value={leave}
          onChange={(e) => setLeave(e.target.value)}
        />
      </Field>
      <Field id="calc-salary" label={t("outstandingSalary")}>
        <Input
          id="calc-salary"
          inputMode="decimal"
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
        />
      </Field>
    </ActionDialog>
  );
}

function ApproveDialog({ caseId }: { caseId: string }) {
  const t = useTranslations("jml.leavers.settlement");
  const { run, busy } = useJmlAction(t("failed"));
  const [ref, setRef] = useState("");
  return (
    <ActionDialog
      trigger={<Button size="sm">{t("approve")}</Button>}
      title={t("approveTitle")}
      description={t("approveBody")}
      confirmLabel={t("approve")}
      busy={busy}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.post(`/api/jml/leavers/${caseId}/settlement/approve`, {
                signatureReference: ref.trim() || null,
              }),
            t("approved"),
          ),
        )
      }
    >
      <Field id="appr-ref" label={t("signatureRef")}>
        <Input id="appr-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}

function PaymentDialog({ caseId, deadline }: { caseId: string; deadline: string | null }) {
  const t = useTranslations("jml.leavers.settlement");
  const { run, busy } = useJmlAction(t("failed"));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  return (
    <ActionDialog
      trigger={<Button size="sm">{t("confirmPayment")}</Button>}
      title={t("paymentTitle")}
      description={deadline ? t("paymentBody", { deadline }) : undefined}
      confirmLabel={t("confirmPayment")}
      busy={busy}
      disabled={!date || !ref.trim()}
      onConfirm={async () =>
        Boolean(
          await run(
            () =>
              apiClient.post(`/api/jml/leavers/${caseId}/settlement/payment`, {
                paymentDate: date,
                paymentReference: ref.trim(),
              }),
            t("paid"),
          ),
        )
      }
    >
      <Field id="pay-date" label={t("paymentDate")}>
        <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field id="pay-ref" label={t("paymentRef")}>
        <Input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
    </ActionDialog>
  );
}
