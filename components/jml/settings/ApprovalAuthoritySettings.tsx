"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmployeePicker } from "@/components/pms/EmployeePicker";
import { apiClient } from "@/lib/api-client";
import { Field } from "@/components/shared/FormControls";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

type Person = { id: string; name: string } | null;
type Row = {
  approvalType: string;
  holders: string[];
  requiresSecondLevel: boolean;
  saved: {
    holderLabel: string;
    active: boolean;
    delegate: Person;
    secondLevelDelegate: Person;
  } | null;
};

/** Approval authority (Offboarding AC-11.1/11.2): per type, the delegate and — for two types — the second level. */
export function ApprovalAuthoritySettings() {
  const t = useTranslations("jml.settings.authority");
  const { can, isLoading } = useJmlAccess();
  const q = useQuery({
    queryKey: ["jml", "approval-authority"],
    queryFn: () => apiClient.get<Row[]>("/api/jml/config/approval-authority"),
    enabled: can("jml.configure"),
  });
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (isLoading || q.isLoading)
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  if (!can("jml.configure")) return <NotPermitted title={t("title")} />;
  if (q.isError || !q.data)
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed />
      </div>
    );
  return (
    <div className="space-y-6">
      {header}
      {q.data.map((row) => (
        <AuthorityCard
          key={row.approvalType}
          row={row}
          editable={can("jml.manageApprovalAuthority")}
        />
      ))}
    </div>
  );
}

function AuthorityCard({ row, editable }: { row: Row; editable: boolean }) {
  const t = useTranslations("jml.settings.authority");
  const tv = useTranslations("jml.leavers.vocab");
  const { run, busy } = useJmlAction(t("failed"));
  const [label, setLabel] = useState(row.saved?.holderLabel ?? row.holders.join(" + "));
  const [delegate, setDelegate] = useState<Person>(row.saved?.delegate ?? null);
  const [second, setSecond] = useState<Person>(row.saved?.secondLevelDelegate ?? null);
  return (
    <SectionCard
      title={tv(`approvalType.${row.approvalType}`)}
      subtitle={t("holders", { list: row.holders.join(" + ") })}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`hl-${row.approvalType}`} label={t("holderLabel")}>
          <Input
            id={`hl-${row.approvalType}`}
            value={label}
            disabled={!editable}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <PersonField
          id={`dl-${row.approvalType}`}
          label={t("delegate")}
          value={delegate}
          onChange={setDelegate}
          editable={editable}
        />
        {row.requiresSecondLevel ? (
          <PersonField
            id={`sl-${row.approvalType}`}
            label={t("secondLevel")}
            value={second}
            onChange={setSecond}
            editable={editable}
            hint={t("secondLevelHint")}
          />
        ) : null}
      </div>
      {editable ? (
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            disabled={busy || label.trim().length < 2}
            onClick={() =>
              void run(
                () =>
                  apiClient.put("/api/jml/config/approval-authority", {
                    approvalType: row.approvalType,
                    holderLabel: label.trim(),
                    delegateEmployeeId: delegate?.id ?? null,
                    secondLevelDelegateEmployeeId: row.requiresSecondLevel
                      ? (second?.id ?? null)
                      : null,
                    active: true,
                  }),
                t("saved"),
              )
            }
          >
            {t("save")}
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}

function PersonField({
  id,
  label,
  value,
  onChange,
  editable,
  hint,
}: {
  id: string;
  label: string;
  value: Person;
  onChange: (p: Person) => void;
  editable: boolean;
  hint?: string;
}) {
  const t = useTranslations("jml.settings.authority");
  if (value) {
    return (
      <Field id={id} label={label} hint={hint}>
        <div id={id} className="flex items-center gap-2 text-sm">
          <span>{value.name}</span>
          {editable ? (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              {t("change")}
            </Button>
          ) : null}
        </div>
      </Field>
    );
  }
  return editable ? (
    <div className="space-y-1">
      <EmployeePicker id={id} label={label} onPick={(p) => onChange({ id: p.id, name: p.name })} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  ) : (
    <Field id={id} label={label}>
      <span id={id} className="text-sm text-muted-foreground">
        {t("none")}
      </span>
    </Field>
  );
}
