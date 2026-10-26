"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { Field } from "../Field";
import { LoadingBlock } from "../States";
import { useJmlAction, type Lookups } from "../use-jml";

/** The rule editor and the "who would own a case here?" preview. */

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

export function RuleForm({
  lookups,
  rule,
  onDone,
}: {
  lookups: Lookups;
  rule: Rule | null;
  onDone: () => void;
}) {
  const t = useTranslations("jml.settings.rules");
  const { run, busy } = useJmlAction(t("saveFailed"));
  const [scope, setScope] = useState<Rule["scope"]>(rule?.scope ?? "COMPANY");
  const [scopeId, setScopeId] = useState(rule?.scopeId ?? "");
  const [junior, setJunior] = useState(rule?.juniorHr.id ?? "");
  const [senior, setSenior] = useState(rule?.seniorHr.id ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? 0));
  const [active, setActive] = useState(rule?.active ?? true);
  const [types, setTypes] = useState<string[]>(rule?.caseTypes ?? []);
  const units =
    scope === "COMPANY"
      ? lookups.companies
      : scope === "DIRECTORATE"
        ? lookups.directorates
        : lookups.departments;
  return (
    <SectionCard title={rule ? t("editTitle") : t("addTitle")} subtitle={t("seatNote")}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const payload = {
            scope,
            scopeId,
            juniorHrUserId: junior,
            seniorHrUserId: senior,
            priority: Number(priority) || 0,
            active,
            caseTypes: types,
          };
          const done = await run(
            () =>
              rule
                ? apiClient.patch(`/api/jml/config/rules/${rule.id}`, payload)
                : apiClient.post("/api/jml/config/rules", payload),
            t("saved"),
          );
          if (done) onDone();
        }}
      >
        <Field id="rule-scope" label={t("level")}>
          <NativeSelect
            id="rule-scope"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as Rule["scope"]);
              setScopeId("");
            }}
            className="w-full"
          >
            {(["COMPANY", "DIRECTORATE", "DEPARTMENT"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`scope.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="rule-unit" label={t("appliesTo")}>
          <NativeSelect
            id="rule-unit"
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="w-full"
            required
          >
            <option value="">{t("choose")}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="rule-owner" label={t("owner")}>
          <NativeSelect
            id="rule-owner"
            value={junior}
            onChange={(e) => setJunior(e.target.value)}
            className="w-full"
            required
          >
            <option value="">{t("choose")}</option>
            {lookups.hrUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="rule-senior" label={t("senior")}>
          <NativeSelect
            id="rule-senior"
            value={senior}
            onChange={(e) => setSenior(e.target.value)}
            className="w-full"
            required
          >
            <option value="">{t("choose")}</option>
            {lookups.hrUsers
              .filter((u) => u.supervises)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field id="rule-priority" label={t("priority")} hint={t("priorityHint")}>
          <Input
            id="rule-priority"
            type="number"
            min={0}
            max={1000}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-foreground">{t("caseTypes")}</legend>
          <div className="flex flex-wrap gap-3">
            {CASE_TYPES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={types.includes(c)}
                  onChange={() =>
                    setTypes(types.includes(c) ? types.filter((x) => x !== c) : [...types, c])
                  }
                />
                {t(`caseType.${c}`)}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t("caseTypesHint")}</p>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("active")}
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {t("save")}
          </Button>
          {rule ? (
            <Button type="button" variant="outline" onClick={onDone}>
              {t("cancel")}
            </Button>
          ) : null}
        </div>
      </form>
    </SectionCard>
  );
}

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
