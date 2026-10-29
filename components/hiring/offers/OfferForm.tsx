"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { SectionCard } from "@/components/shared/SectionCard";
import { ALLOWANCE_KEYS } from "@/lib/hiring/offer-package";
import { qs, useHiringQuery } from "../ui/api";
import { Field, Textarea } from "@/components/shared/FormControls";
import { StageBadge } from "../ui/stage";
import { ChainPreview } from "./ChainPreview";
import { useAllowanceLabel } from "./bits";

/**
 * Draft / edit an offer (Interview Hub `OfferForm`): candidate, basic, the
 * allowance breakdown, start date and terms, with the approval chain the
 * TOTAL monthly pay would route to.
 */
export type CandidateRef = {
  id: string;
  name: string;
  stage: string;
  requisition: { id: string; title: string } | null;
};
export type Allowance = { key: string; amount: string };
export type OfferFormValues = {
  candidate: CandidateRef | null;
  salary: string;
  allowances: Allowance[];
  startDate: string;
  probationMonths: string;
  noticePeriod: string;
  contractType: string;
  benefits: string;
};

const CONTRACT_TYPES = ["Permanent", "Fixed term", "Part time", "Internship"] as const;

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function toOfferBody(v: OfferFormValues, withPay: boolean) {
  const allowances = Object.fromEntries(
    v.allowances
      .filter((a) => a.key.trim() && num(a.amount) !== null)
      .map((a) => [a.key.trim(), num(a.amount) as number]),
  );
  return {
    ...(withPay
      ? { salary: num(v.salary), allowances: Object.keys(allowances).length ? allowances : null }
      : {}),
    startDate: v.startDate,
    probationMonths: Number(v.probationMonths || 0),
    noticePeriod: v.noticePeriod.trim() || null,
    contractType: v.contractType || null,
    benefits: v.benefits.trim() || null,
  };
}

const totalOf = (v: Pick<OfferFormValues, "salary" | "allowances">) =>
  (num(v.salary) ?? 0) + v.allowances.reduce((s, a) => s + (num(a.amount) ?? 0), 0);

function CandidatePicker({
  value,
  onChange,
}: {
  value: CandidateRef | null;
  onChange: (c: CandidateRef | null) => void;
}) {
  const t = useTranslations("hiring.offerForm");
  const [search, setSearch] = useState("");
  const { data, isLoading } = useHiringQuery<{ data: CandidateRef[] }>(
    value ? null : `/api/hiring/candidates${qs({ search, pageSize: 10 })}`,
  );
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-input px-3 py-1.5 text-sm">
        <span>
          {value.name}
          <span className="text-muted-foreground">
            {" "}
            · {value.requisition?.title ?? t("noRequisition")}
          </span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t("change")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Input
        id="of-cand"
        placeholder={t("searchCandidates")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
        {isLoading ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">{t("loading")}</li>
        ) : null}
        {(data?.data ?? []).map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-muted"
              onClick={() => onChange(c)}
            >
              <span>
                {c.name}
                <span className="text-muted-foreground">
                  {" "}
                  · {c.requisition?.title ?? t("noRequisition")}
                </span>
              </span>
              <StageBadge stage={c.stage} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AllowanceEditor({
  value,
  onChange,
}: {
  value: Allowance[];
  onChange: (v: Allowance[]) => void;
}) {
  const t = useTranslations("hiring.offerForm");
  const label = useAllowanceLabel();
  const set = (i: number, patch: Partial<Allowance>) =>
    onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const unused = ALLOWANCE_KEYS.filter((k) => !value.some((a) => a.key === k));
  return (
    <div className="space-y-2">
      {value.map((a, i) => (
        <div key={i} className="flex items-center gap-2">
          <NativeSelect
            aria-label={t("allowanceKind")}
            value={a.key}
            onChange={(e) => set(i, { key: e.target.value })}
            className="w-48"
          >
            {[a.key, ...unused].map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </NativeSelect>
          <Input
            aria-label={t("allowanceAmount", { name: label(a.key) })}
            type="number"
            min={0}
            step="0.001"
            className="w-36"
            value={a.amount}
            onChange={(e) => set(i, { amount: e.target.value })}
          />
          <span className="text-xs text-muted-foreground">{t("perMonth")}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("removeAllowance", { name: label(a.key) })}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {unused.length ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, { key: unused[0], amount: "" }])}
        >
          <Plus className="h-4 w-4" />
          {t("addAllowance")}
        </Button>
      ) : null}
    </div>
  );
}

export function OfferForm({
  initial,
  lockCandidate,
  showPay,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: OfferFormValues;
  lockCandidate?: boolean;
  showPay: boolean;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (v: OfferFormValues) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("hiring.offerForm");
  const [v, setV] = useState(initial);
  const valid = Boolean(v.candidate && v.startDate);
  return (
    <form
      className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(v);
      }}
    >
      <div className="space-y-4">
        <SectionCard title={t("sectionWho")}>
          <Field label={t("candidate")} htmlFor="of-cand" required hint={t("candidateHint")}>
            {lockCandidate && v.candidate ? (
              <p className="text-sm">
                {v.candidate.name} · {v.candidate.requisition?.title}
              </p>
            ) : (
              <CandidatePicker
                value={v.candidate}
                onChange={(candidate) => setV({ ...v, candidate })}
              />
            )}
          </Field>
        </SectionCard>
        {showPay ? (
          <SectionCard title={t("sectionPay")} subtitle={t("sectionPayHint")}>
            <div className="space-y-4">
              <Field label={t("basic")} htmlFor="of-basic" hint={t("basicHint")}>
                <Input
                  id="of-basic"
                  type="number"
                  min={0}
                  step="0.001"
                  className="w-48"
                  value={v.salary}
                  onChange={(e) => setV({ ...v, salary: e.target.value })}
                />
              </Field>
              <Field label={t("allowances")} htmlFor="of-allowances" hint={t("allowancesHint")}>
                <AllowanceEditor
                  value={v.allowances}
                  onChange={(allowances) => setV({ ...v, allowances })}
                />
              </Field>
              <p className="text-sm">
                <span className="text-muted-foreground">{t("totalMonthly")} </span>
                <span className="font-mono font-semibold">
                  {t("omrPerMonth", { amount: totalOf(v).toLocaleString("en-US") })}
                </span>
              </p>
            </div>
          </SectionCard>
        ) : null}
        <SectionCard title={t("sectionTerms")}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("startDate")} htmlFor="of-start" required>
              <Input
                id="of-start"
                type="date"
                value={v.startDate}
                onChange={(e) => setV({ ...v, startDate: e.target.value })}
              />
            </Field>
            <Field label={t("contractType")} htmlFor="of-contract">
              <NativeSelect
                id="of-contract"
                value={v.contractType}
                onChange={(e) => setV({ ...v, contractType: e.target.value })}
              >
                {CONTRACT_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {t(`contract.${c.replace(/ /g, "")}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("probation")} htmlFor="of-probation" hint={t("probationHint")}>
              <Input
                id="of-probation"
                type="number"
                min={0}
                max={24}
                className="w-32"
                value={v.probationMonths}
                onChange={(e) => setV({ ...v, probationMonths: e.target.value })}
              />
            </Field>
            <Field label={t("noticePeriod")} htmlFor="of-notice">
              <Input
                id="of-notice"
                maxLength={100}
                value={v.noticePeriod}
                onChange={(e) => setV({ ...v, noticePeriod: e.target.value })}
              />
            </Field>
            <Field
              label={t("benefits")}
              htmlFor="of-benefits"
              hint={t("benefitsHint")}
              className="md:col-span-2"
            >
              <Textarea
                id="of-benefits"
                rows={2}
                maxLength={500}
                value={v.benefits}
                onChange={(e) => setV({ ...v, benefits: e.target.value })}
              />
            </Field>
          </div>
        </SectionCard>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={submitting || !valid}>
            {submitLabel}
          </Button>
        </div>
      </div>
      {v.candidate && showPay ? (
        <ChainPreview candidateId={v.candidate.id} total={totalOf(v)} />
      ) : null}
    </form>
  );
}
