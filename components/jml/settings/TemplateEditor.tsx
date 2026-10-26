"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { apiClient } from "@/lib/api-client";
import { Field } from "../Field";
import {
  BASES,
  CHANGE_TYPES,
  CRITERIA,
  STAGES,
  TaskRowEditor,
  type CaseType,
  type TaskDraft,
} from "./TemplateTaskRow";
import { useJmlAction } from "../use-jml";

export type TemplateDetail = {
  id: string;
  name: string;
  version: number;
  active: boolean;
  caseType: CaseType;
  changeType: string | null;
  criteria: Record<string, string>;
  employmentScope: string;
  nationalityScope: string;
  _count: { cases: number };
  tasks: Array<TaskDraft & { id: string }>;
};

function blankTask(caseType: CaseType, index: number): TaskDraft {
  return {
    code: `T-${String(index + 1).padStart(2, "0")}`,
    name: "",
    stage: STAGES[caseType][0]!,
    sortOrder: index,
    dateBasis: BASES[caseType][0]!,
    offsetDays: 0,
    offsetUnit: caseType === "LEAVE" ? "WORKING_DAYS" : "CALENDAR_DAYS",
    mandatory: true,
    blocking: false,
    confirmationRequired: false,
    defaultConfirmingParty: null,
    reversalFlag: false,
    dependsOnCodes: [],
    statutory: false,
    complianceCategory: null,
    conditions: {},
    appliesToExitTypes: [],
    appliesToNationality: "ANY",
    appliesToSettlement: null,
  };
}

/**
 * The template editor — Onboarding `TemplateDialog` + `TemplateTaskRowEditor`
 * + `TemplateTaskConditions`, and the Offboarding template fields (code, date
 * basis, blocking, confirmation, reversal, dependencies, applicability), on one
 * form whose fields follow the case type.
 */
export function TemplateEditor({
  template,
  onClose,
}: {
  template: TemplateDetail | null;
  onClose: () => void;
}) {
  const t = useTranslations("jml.settings.templates");
  const { run, busy } = useJmlAction(t("saveFailed"));
  const [name, setName] = useState(template?.name ?? "");
  const [caseType, setCaseType] = useState<CaseType>(template?.caseType ?? "JOIN");
  const [changeType, setChangeType] = useState(template?.changeType ?? "");
  const [criteria, setCriteria] = useState<Record<string, string>>(template?.criteria ?? {});
  const [employmentScope, setEmploymentScope] = useState(template?.employmentScope ?? "ANY");
  const [nationalityScope, setNationalityScope] = useState(template?.nationalityScope ?? "ANY");
  const [active, setActive] = useState(template?.active ?? true);
  const [tasks, setTasks] = useState<TaskDraft[]>(
    template ? template.tasks.map(({ id: _id, ...rest }) => rest) : [blankTask("JOIN", 0)],
  );
  const update = (i: number, patch: Partial<TaskDraft>) =>
    setTasks(tasks.map((task, j) => (j === i ? { ...task, ...patch } : task)));

  async function save() {
    const payload = {
      name,
      active,
      ...(template ? {} : { caseType }),
      changeType: caseType === "MOVE" ? changeType || null : null,
      criteria: Object.fromEntries(Object.entries(criteria).filter(([, v]) => v)),
      employmentScope,
      nationalityScope,
      tasks,
    };
    const done = await run(
      () =>
        template
          ? apiClient.patch(`/api/jml/config/templates/${template.id}`, payload)
          : apiClient.post("/api/jml/config/templates", payload),
      template ? t("versionSaved") : t("created"),
    );
    if (done) onClose();
  }

  return (
    <SectionCard
      title={
        template
          ? t("editTitle", { name: template.name, version: template.version })
          : t("newTitle")
      }
      subtitle={
        template && template._count.cases > 0
          ? t("pinnedWarning", { count: template._count.cases })
          : t("versionNote")
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="tpl-name" label={t("name")}>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="tpl-type" label={t("caseType")}>
            <NativeSelect
              id="tpl-type"
              value={caseType}
              disabled={Boolean(template)}
              onChange={(e) => {
                const next = e.target.value as CaseType;
                setCaseType(next);
                setTasks([blankTask(next, 0)]);
              }}
              className="w-full"
            >
              {(["JOIN", "MOVE", "LEAVE"] as const).map((c) => (
                <option key={c} value={c}>
                  {t(`caseTypeValue.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {caseType === "MOVE" ? (
            <Field id="tpl-change" label={t("changeTypeLabel")}>
              <NativeSelect
                id="tpl-change"
                value={changeType}
                onChange={(e) => setChangeType(e.target.value)}
                className="w-full"
              >
                <option value="">{t("choose")}</option>
                {CHANGE_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {t(`changeType.${c}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
        </div>
        {caseType === "LEAVE" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tpl-emp" label={t("employmentScope")} hint={t("employmentScopeHint")}>
              <NativeSelect
                id="tpl-emp"
                value={employmentScope}
                onChange={(e) => setEmploymentScope(e.target.value)}
                className="w-full"
              >
                {["FULL", "LIGHT", "ANY"].map((s) => (
                  <option key={s} value={s}>
                    {t(`scopeValue.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="tpl-nat" label={t("nationalityScope")}>
              <NativeSelect
                id="tpl-nat"
                value={nationalityScope}
                onChange={(e) => setNationalityScope(e.target.value)}
                className="w-full"
              >
                {["OMANI", "EXPATRIATE", "ANY"].map((s) => (
                  <option key={s} value={s}>
                    {t(`nationalityValue.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        ) : (
          <fieldset className="rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium text-foreground">{t("criteria")}</legend>
            <p className="mb-2 text-xs text-muted-foreground">{t("criteriaHint")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {CRITERIA.map((key) => (
                <Field key={key} id={`crit-${key}`} label={t(`fact.${key}`)}>
                  <Input
                    id={`crit-${key}`}
                    value={criteria[key] ?? ""}
                    placeholder={t("any")}
                    onChange={(e) => setCriteria({ ...criteria, [key]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        )}
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("active")}
        </label>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            {t("taskRows", { count: tasks.length })}
          </h3>
          {tasks.map((task, i) => (
            <TaskRowEditor
              key={i}
              index={i}
              task={task}
              caseType={caseType}
              onChange={(patch) => update(i, patch)}
              onRemove={
                tasks.length > 1 ? () => setTasks(tasks.filter((_, j) => j !== i)) : undefined
              }
            />
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => setTasks([...tasks, blankTask(caseType, tasks.length)])}
          >
            {t("addTask")}
          </Button>
        </div>
        <div className="flex gap-2 border-t border-border pt-4">
          <Button onClick={() => void save()} disabled={busy || !name.trim()}>
            {template ? t("saveVersion") : t("create")}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
