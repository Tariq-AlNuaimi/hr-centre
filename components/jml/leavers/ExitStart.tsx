"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmployeePicker } from "@/components/pms/EmployeePicker";
import { apiClient } from "@/lib/api-client";
import { Field } from "../Field";
import { LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";
import { ExitDateFields } from "./ExitDateFields";
import { DOCUMENTED, EMPTY_EXIT, datesPayload, type ExitValues } from "./exit-values";

/**
 * Open an exit — Offboarding `/exits/new` on the core record: the employee is
 * picked (their job, placement, employment type and line manager come from the
 * record), then the exit facts. The draft creates nothing else (AC-1.1).
 */
export function ExitStart() {
  const t = useTranslations("jml.leavers");
  const { can, isLoading } = useJmlAccess();
  const router = useRouter();
  const { run, busy } = useJmlAction(t("form.failed"));
  const [employee, setEmployee] = useState<{ id: string; name: string } | null>(null);
  const [values, setValues] = useState<ExitValues>(EMPTY_EXIT);
  const [settlement, setSettlement] = useState(true);
  const [visa, setVisa] = useState(false);
  const [refs, setRefs] = useState({ perf: "", grounds: "", legal: "" });
  if (isLoading) return <LoadingBlock />;
  if (!can("jml.manageLeavers")) return <NotPermitted title={t("newTitle")} />;
  const submit = async () => {
    if (!employee) return;
    const r = await run(
      () =>
        apiClient.post<{ id: string; caseRef: string }>("/api/jml/leavers", {
          employeeId: employee.id,
          ...datesPayload(values),
          settlementApplicable: settlement,
          visaSupportApplicable: visa,
          docRefPerformanceHistory: refs.perf.trim() || null,
          docRefWrittenGrounds: refs.grounds.trim() || null,
          docRefLegalReview: refs.legal.trim() || null,
        }),
      t("form.created"),
    );
    if (r) router.push(`/jml/cases/${r.id}?tab=overview`);
  };
  return (
    <div className="space-y-6">
      <PageHeader title={t("newTitle")} subtitle={t("newSubtitle")} />
      <SectionCard title={t("form.who")}>
        {employee ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium">{employee.name}</span>
            <Button size="sm" variant="ghost" onClick={() => setEmployee(null)}>
              {t("form.changeEmployee")}
            </Button>
          </div>
        ) : (
          <EmployeePicker
            id="exit-pick"
            label={t("form.employee")}
            onPick={(x) => setEmployee({ id: x.id, name: x.name })}
          />
        )}
      </SectionCard>
      <SectionCard title={t("form.facts")} subtitle={t("form.factsNote")}>
        <div className="space-y-4">
          <ExitDateFields values={values} onChange={setValues} nationalityOptional />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settlement}
              onChange={(e) => setSettlement(e.target.checked)}
            />
            {t("form.settlementApplicable")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={visa} onChange={(e) => setVisa(e.target.checked)} />
            {t("form.visaSupport")}
          </label>
        </div>
      </SectionCard>
      {DOCUMENTED.has(values.exitType) ? (
        <SectionCard title={t("form.docs")} subtitle={t("form.docsNote")}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="ref-perf" label={t("form.docPerf")}>
              <Input
                id="ref-perf"
                value={refs.perf}
                onChange={(e) => setRefs({ ...refs, perf: e.target.value })}
              />
            </Field>
            <Field id="ref-grounds" label={t("form.docGrounds")}>
              <Input
                id="ref-grounds"
                value={refs.grounds}
                onChange={(e) => setRefs({ ...refs, grounds: e.target.value })}
              />
            </Field>
            <Field id="ref-legal" label={t("form.docLegal")}>
              <Input
                id="ref-legal"
                value={refs.legal}
                onChange={(e) => setRefs({ ...refs, legal: e.target.value })}
              />
            </Field>
          </div>
        </SectionCard>
      ) : null}
      <div className="flex justify-end">
        <Button
          disabled={!employee || !values.noticeStartDate || busy}
          onClick={() => void submit()}
        >
          {t("form.save")}
        </Button>
      </div>
    </div>
  );
}
