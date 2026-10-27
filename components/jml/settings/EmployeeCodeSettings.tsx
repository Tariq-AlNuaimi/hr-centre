"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Field } from "../Field";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

type Sequence = {
  prefix: string;
  digits: number;
  lastManualId: string;
  nextValue: number;
  cutoverAt: string;
  approvedBy: string;
  updatedAt: string;
} | null;

const pad = (prefix: string, digits: number, value: number) =>
  `${prefix}${String(value).padStart(digits, "0")}`;

/** The EMP-code cutover (Onboarding §14.1, BR-003/BR-021): until recorded, onboarding activation is blocked. */
export function EmployeeCodeSettings() {
  const t = useTranslations("jml.settings.employeeCode");
  const { can, isLoading } = useJmlAccess();
  const allowed = can("jml.configure");
  const q = useQuery({
    queryKey: ["jml", "employee-code"],
    queryFn: () => apiClient.get<Sequence>("/api/jml/config/employee-code"),
    enabled: allowed,
  });
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (isLoading || (allowed && q.isLoading))
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  if (!allowed)
    return (
      <div className="space-y-6">
        {header}
        <NotPermitted title={t("title")} />
      </div>
    );
  if (q.isError)
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed />
      </div>
    );
  const seq = q.data ?? null;
  return (
    <div className="space-y-6">
      {header}
      {seq ? (
        <SectionCard title={t("current")}>
          <DescriptionList
            columns={2}
            items={[
              {
                key: "next",
                label: t("nextToIssue"),
                value: pad(seq.prefix, seq.digits, seq.nextValue),
              },
              { key: "last", label: t("lastManualId"), value: seq.lastManualId },
              {
                key: "cutover",
                label: t("cutoverAt"),
                value: formatDateTime(seq.cutoverAt),
              },
              { key: "approved", label: t("approvedBy"), value: seq.approvedBy },
            ]}
          />
        </SectionCard>
      ) : (
        <p
          role="status"
          className="rounded-md border border-border bg-status-warn p-3 text-sm text-status-warn-fg"
        >
          {t("notConfigured")}
        </p>
      )}
      <CutoverForm key={JSON.stringify(seq)} seq={seq} />
    </div>
  );
}

function CutoverForm({ seq }: { seq: Sequence }) {
  const t = useTranslations("jml.settings.employeeCode");
  const { run, busy } = useJmlAction(t("saveFailed"));
  const [prefix, setPrefix] = useState(seq?.prefix ?? "EMP");
  const [digits, setDigits] = useState(String(seq?.digits ?? 4));
  const [lastManualId, setLast] = useState(seq?.lastManualId ?? "");
  const [nextValue, setNext] = useState(seq ? String(seq.nextValue) : "");
  const [cutoverAt, setCutover] = useState(seq ? seq.cutoverAt.slice(0, 16) : "");
  const [approvedBy, setApproved] = useState(seq?.approvedBy ?? "");
  const preview =
    Number(nextValue) > 0 ? pad(prefix.toUpperCase(), Number(digits) || 4, Number(nextValue)) : "";
  return (
    <SectionCard
      title={seq ? t("update") : t("configure")}
      subtitle={seq ? t("forwardOnly") : t("firstRule")}
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              apiClient.put("/api/jml/config/employee-code", {
                prefix,
                digits: Number(digits),
                lastManualId,
                nextValue: Number(nextValue),
                cutoverAt: new Date(cutoverAt).toISOString(),
                approvedBy,
              }),
            t("saved"),
          );
        }}
      >
        <Field id="ec-prefix" label={t("prefix")}>
          <Input id="ec-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </Field>
        <Field id="ec-digits" label={t("digits")}>
          <Input
            id="ec-digits"
            type="number"
            min={3}
            max={8}
            value={digits}
            onChange={(e) => setDigits(e.target.value)}
          />
        </Field>
        <Field id="ec-last" label={t("lastManualId")} hint={t("lastHint")}>
          <Input
            id="ec-last"
            value={lastManualId}
            onChange={(e) => setLast(e.target.value)}
            required
          />
        </Field>
        <Field
          id="ec-next"
          label={t("nextValue")}
          hint={preview ? t("preview", { code: preview }) : undefined}
        >
          <Input
            id="ec-next"
            type="number"
            min={1}
            value={nextValue}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </Field>
        <Field id="ec-at" label={t("cutoverAt")}>
          <Input
            id="ec-at"
            type="datetime-local"
            value={cutoverAt}
            onChange={(e) => setCutover(e.target.value)}
            required
          />
        </Field>
        <Field id="ec-by" label={t("approvedBy")}>
          <Input
            id="ec-by"
            value={approvedBy}
            onChange={(e) => setApproved(e.target.value)}
            required
          />
        </Field>
        <div>
          <Button type="submit" disabled={busy}>
            {t("save")}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
