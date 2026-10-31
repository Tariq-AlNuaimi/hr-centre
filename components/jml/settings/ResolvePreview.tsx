"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { Field } from "@/components/shared/FormControls";
import { LoadingBlock } from "../States";
import type { Lookups } from "../use-jml";

/**
 * "Who would own a case here?" — the JML preview of the core HR coverage rules
 * (ADR-102), shown on Admin › Settings › HR coverage.
 */

export type Rule = {
  id: string;
  scope: "COMPANY" | "DIRECTORATE" | "DEPARTMENT";
  scopeId: string;
  priority: number;
  active: boolean;
  caseTypes: string[];
  juniorHr: { id: string; name: string | null; email: string };
  seniorHr: { id: string; name: string | null; email: string };
};
const CASE_TYPES = ["JOIN", "MOVE", "LEAVE"] as const;

export function ResolvePreview({ lookups }: { lookups: Lookups }) {
  const t = useTranslations("jml.settings.rules");
  const [entityId, setEntityId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [caseType, setCaseType] = useState("JOIN");
  const department = lookups.departments.find((d) => d.id === departmentId);
  const q = useQuery({
    queryKey: ["jml", "rules", "resolve", entityId, departmentId, caseType],
    queryFn: () =>
      apiClient.get<{ rule: Rule; matchedScope: string; candidateCount: number } | null>(
        `/api/jml/config/rules/resolve?entityId=${entityId}&caseType=${caseType}` +
          (departmentId ? `&departmentId=${departmentId}` : "") +
          (department?.directorateId ? `&directorateId=${department.directorateId}` : ""),
      ),
    enabled: Boolean(entityId),
  });
  return (
    <SectionCard title={t("previewTitle")} subtitle={t("previewNote")}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="rp-company" label={t("scope.COMPANY")}>
          <NativeSelect
            id="rp-company"
            value={entityId}
            onChange={(e) => {
              setEntityId(e.target.value);
              setDepartmentId("");
            }}
            className="w-full"
          >
            <option value="">{t("choose")}</option>
            {lookups.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="rp-dept" label={t("scope.DEPARTMENT")}>
          <NativeSelect
            id="rp-dept"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full"
          >
            <option value="">{t("anyDepartment")}</option>
            {lookups.departments
              .filter((d) => d.entityId === entityId)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field id="rp-type" label={t("caseTypes")}>
          <NativeSelect
            id="rp-type"
            value={caseType}
            onChange={(e) => setCaseType(e.target.value)}
            className="w-full"
          >
            {CASE_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`caseType.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="mt-4 text-sm text-foreground" aria-live="polite">
        {!entityId ? null : q.isLoading ? (
          <LoadingBlock />
        ) : q.data ? (
          t("previewResult", {
            owner: q.data.rule.juniorHr.name ?? q.data.rule.juniorHr.email,
            senior: q.data.rule.seniorHr.name ?? q.data.rule.seniorHr.email,
            level: t(`scope.${q.data.matchedScope}`),
            count: q.data.candidateCount,
          })
        ) : (
          t("previewNone")
        )}
      </div>
    </SectionCard>
  );
}
