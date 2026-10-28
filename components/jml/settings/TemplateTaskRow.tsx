"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { Field } from "../Field";

/** One task row of the template editor (Onboarding TemplateTaskRowEditor + conditions; Offboarding fields). */

export type CaseType = "JOIN" | "MOVE" | "LEAVE";
type RuleMode = "any" | "in" | "notIn";
const FACTS = [
  "companyId",
  "employmentType",
  "contractTypeId",
  "nationality",
  "workLocation",
  "payrollApplicable",
] as const;
export const CRITERIA = [
  "companyId",
  "employmentType",
  "contractTypeId",
  "nationality",
  "workLocation",
] as const;
export const STAGES: Record<CaseType, string[]> = {
  JOIN: ["PREBOARDING", "FIRST_DAY", "FIRST_WEEK"],
  MOVE: ["PREBOARDING", "FIRST_DAY", "FIRST_WEEK"],
  LEAVE: [
    "STAGE_1_RESIGNATION",
    "STAGE_2_IMMEDIATE",
    "STAGE_3_NOTICE_HANDOVER",
    "STAGE_4_SETTLEMENT",
  ],
};
export const BASES: Record<CaseType, string[]> = {
  JOIN: ["START_DATE"],
  MOVE: ["EFFECTIVE_DATE"],
  LEAVE: ["NOTICE_START", "LAST_PHYSICAL_WORKING_DAY", "LAST_DAY_OF_SERVICE", "DEPARTURE_DATE"],
};
const EXIT_TYPES = [
  "RESIGNATION",
  "TERMINATION",
  "CONTRACT_EXPIRY",
  "PROBATION_EXIT",
  "SUMMARY_DISMISSAL",
];
export const CHANGE_TYPES = [
  "INTERNSHIP_TO_TRAINING",
  "INTERNSHIP_TO_EMPLOYMENT",
  "TRAINING_TO_EMPLOYMENT",
  "DEPARTMENT_TRANSFER",
];
const CATEGORIES = ["ROP_CLEARANCE", "VISA", "MOL", "OTHER"];

export type TaskDraft = {
  code: string;
  name: string;
  stage: string;
  sortOrder: number;
  dateBasis: string;
  offsetDays: number;
  offsetUnit: "CALENDAR_DAYS" | "WORKING_DAYS";
  mandatory: boolean;
  blocking: boolean;
  confirmationRequired: boolean;
  defaultConfirmingParty: string | null;
  reversalFlag: boolean;
  dependsOnCodes: string[];
  statutory: boolean;
  complianceCategory: string | null;
  conditions: Record<string, { in?: string[]; notIn?: string[] }>;
  appliesToExitTypes: string[];
  appliesToNationality: string;
  appliesToSettlement: boolean | null;
  /** Task routing: who the task is for. */
  assigneeRole: AssigneeRole;
};

const ASSIGNEE_ROLES = ["HR", "LINE_MANAGER", "IT", "FINANCE"] as const;
type AssigneeRole = (typeof ASSIGNEE_ROLES)[number];

const list = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function TaskRowEditor({
  index,
  task,
  caseType,
  onChange,
  onRemove,
}: {
  index: number;
  task: TaskDraft;
  caseType: CaseType;
  onChange: (patch: Partial<TaskDraft>) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("jml.settings.templates");
  const tv = useTranslations("jml.vocab");
  const id = (s: string) => `task-${index}-${s}`;
  const check = (key: keyof TaskDraft, label: string) => (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={Boolean(task[key])}
        onChange={(e) => onChange({ [key]: e.target.checked } as Partial<TaskDraft>)}
      />
      {label}
    </label>
  );
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-foreground">
        {t("taskLegend", { n: index + 1 })}
      </legend>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field id={id("code")} label={t("code")}>
          <Input
            id={id("code")}
            value={task.code}
            onChange={(e) => onChange({ code: e.target.value.toUpperCase() })}
          />
        </Field>
        <div className="sm:col-span-3">
          <Field id={id("name")} label={t("taskName")}>
            <Input
              id={id("name")}
              value={task.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Field>
        </div>
        <Field id={id("assignee")} label={t("assigneeRole")}>
          <NativeSelect
            id={id("assignee")}
            value={task.assigneeRole}
            onChange={(e) => onChange({ assigneeRole: e.target.value as AssigneeRole })}
            className="w-full"
          >
            {ASSIGNEE_ROLES.map((r) => (
              <option key={r} value={r}>
                {tv(`assigneeRole.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={id("stage")} label={t("stage")}>
          <NativeSelect
            id={id("stage")}
            value={task.stage}
            onChange={(e) => onChange({ stage: e.target.value })}
            className="w-full"
          >
            {STAGES[caseType].map((s) => (
              <option key={s} value={s}>
                {t(`stageValue.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={id("basis")} label={t("basis")}>
          <NativeSelect
            id={id("basis")}
            value={task.dateBasis}
            onChange={(e) => onChange({ dateBasis: e.target.value })}
            className="w-full"
          >
            {BASES[caseType].map((b) => (
              <option key={b} value={b}>
                {t(`basisValue.${b}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={id("offset")} label={t("offset")}>
          <Input
            id={id("offset")}
            type="number"
            min={-365}
            max={365}
            value={task.offsetDays}
            onChange={(e) => onChange({ offsetDays: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field id={id("unit")} label={t("unit")}>
          <NativeSelect
            id={id("unit")}
            value={task.offsetUnit}
            onChange={(e) => onChange({ offsetUnit: e.target.value as TaskDraft["offsetUnit"] })}
            className="w-full"
          >
            <option value="CALENDAR_DAYS">{t("unitValue.CALENDAR_DAYS")}</option>
            <option value="WORKING_DAYS">{t("unitValue.WORKING_DAYS")}</option>
          </NativeSelect>
        </Field>
        <Field id={id("order")} label={t("order")}>
          <Input
            id={id("order")}
            type="number"
            min={0}
            value={task.sortOrder}
            onChange={(e) => onChange({ sortOrder: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field id={id("deps")} label={t("dependsOn")} hint={t("commaHint")}>
          <Input
            id={id("deps")}
            value={task.dependsOnCodes.join(", ")}
            onChange={(e) => onChange({ dependsOnCodes: list(e.target.value.toUpperCase()) })}
          />
        </Field>
        <Field id={id("party")} label={t("confirmingParty")}>
          <Input
            id={id("party")}
            value={task.defaultConfirmingParty ?? ""}
            onChange={(e) => onChange({ defaultConfirmingParty: e.target.value || null })}
          />
        </Field>
        <Field id={id("cat")} label={t("category")}>
          <NativeSelect
            id={id("cat")}
            value={task.complianceCategory ?? ""}
            onChange={(e) => onChange({ complianceCategory: e.target.value || null })}
            className="w-full"
          >
            <option value="">{t("none")}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categoryValue.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        {check("mandatory", t("mandatory"))}
        {check("blocking", t("blocking"))}
        {check("confirmationRequired", t("confirmation"))}
        {check("reversalFlag", t("reversal"))}
        {check("statutory", t("statutory"))}
      </div>
      {caseType === "LEAVE" ? (
        <LeaveApplicability task={task} id={id} onChange={onChange} />
      ) : (
        <Conditions task={task} id={id} onChange={onChange} />
      )}
      {onRemove ? (
        <Button type="button" size="sm" variant="outline" onClick={onRemove}>
          {t("removeTask")}
        </Button>
      ) : null}
    </fieldset>
  );
}

function Conditions({
  task,
  id,
  onChange,
}: {
  task: TaskDraft;
  id: (s: string) => string;
  onChange: (p: Partial<TaskDraft>) => void;
}) {
  const t = useTranslations("jml.settings.templates");
  const modeOf = (fact: string): RuleMode =>
    task.conditions[fact]?.in ? "in" : task.conditions[fact]?.notIn ? "notIn" : "any";
  const valuesOf = (fact: string) =>
    (task.conditions[fact]?.in ?? task.conditions[fact]?.notIn ?? []).join(", ");
  const set = (fact: string, mode: RuleMode, values: string) => {
    const next = { ...task.conditions };
    const parsed = list(values);
    if (mode === "any") delete next[fact];
    else next[fact] = { [mode]: parsed };
    onChange({ conditions: next });
  };
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {FACTS.map((fact) => (
        <div key={fact} className="space-y-1">
          <Field id={id(`cond-${fact}`)} label={t(`fact.${fact}`)}>
            <NativeSelect
              id={id(`cond-${fact}`)}
              value={modeOf(fact)}
              onChange={(e) => set(fact, e.target.value as RuleMode, valuesOf(fact))}
              className="w-full"
            >
              <option value="any">{t("condAny")}</option>
              <option value="in">{t("condIn")}</option>
              <option value="notIn">{t("condNotIn")}</option>
            </NativeSelect>
          </Field>
          {modeOf(fact) === "any" ? null : (
            <Input
              aria-label={t("condValues")}
              value={valuesOf(fact)}
              onChange={(e) => set(fact, modeOf(fact), e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function LeaveApplicability({
  task,
  id,
  onChange,
}: {
  task: TaskDraft;
  id: (s: string) => string;
  onChange: (p: Partial<TaskDraft>) => void;
}) {
  const t = useTranslations("jml.settings.templates");
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-foreground">{t("exitTypes")}</legend>
        <div className="flex flex-col gap-1">
          {EXIT_TYPES.map((x) => (
            <label key={x} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={task.appliesToExitTypes.includes(x)}
                onChange={() =>
                  onChange({
                    appliesToExitTypes: task.appliesToExitTypes.includes(x)
                      ? task.appliesToExitTypes.filter((y) => y !== x)
                      : [...task.appliesToExitTypes, x],
                  })
                }
              />
              {t(`exitTypeValue.${x}`)}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("exitTypesHint")}</p>
      </fieldset>
      <Field id={id("appNat")} label={t("nationalityScope")}>
        <NativeSelect
          id={id("appNat")}
          value={task.appliesToNationality}
          onChange={(e) => onChange({ appliesToNationality: e.target.value })}
          className="w-full"
        >
          {["ANY", "OMANI", "EXPATRIATE"].map((s) => (
            <option key={s} value={s}>
              {t(`nationalityValue.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={id("appSet")} label={t("settlement")}>
        <NativeSelect
          id={id("appSet")}
          value={task.appliesToSettlement === null ? "" : String(task.appliesToSettlement)}
          onChange={(e) =>
            onChange({
              appliesToSettlement: e.target.value === "" ? null : e.target.value === "true",
            })
          }
          className="w-full"
        >
          <option value="">{t("settlementAny")}</option>
          <option value="true">{t("settlementYes")}</option>
          <option value="false">{t("settlementNo")}</option>
        </NativeSelect>
      </Field>
    </div>
  );
}
