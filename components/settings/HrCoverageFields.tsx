"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import { Check, Field } from "@/components/shared/FormControls";
import type { CoverageOptions, Form, SetField, Unit, UnitKind } from "./HrCoverageDialog";

/** The three parts of the HR coverage form: the unit, the ticket half, the case half. */

const CASE_TYPES = ["JOIN", "MOVE", "LEAVE"] as const;

export function UnitFields({
  f,
  setForm,
  set,
  options,
  units,
}: {
  f: Form;
  setForm: (next: (prev: Form) => Form) => void;
  set: SetField;
  options: CoverageOptions;
  units: Unit[];
}) {
  const t = useTranslations("hrCoverage");
  return (
    <>
      <Field id="cov-company" label={t("company")}>
        <NativeSelect
          id="cov-company"
          value={f.entityId}
          onChange={(e) => setForm((prev) => ({ ...prev, entityId: e.target.value, unitId: "" }))}
          className="w-full"
        >
          <option value="">{t("anyCompany")}</option>
          {options.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="cov-kind" label={t("level")}>
        <NativeSelect
          id="cov-kind"
          value={f.kind}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, kind: e.target.value as UnitKind, unitId: "" }))
          }
          className="w-full"
        >
          {(["COMPANY", "DIRECTORATE", "DEPARTMENT", "TEAM"] as const).map((k) => (
            <option key={k} value={k}>
              {t(`levels.${k}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {f.kind === "COMPANY" ? (
        <Check id="cov-wide" checked={f.companyWide} onChange={(v) => set("companyWide", v)}>
          {t("companyWide")}
        </Check>
      ) : (
        <Field id="cov-unit" label={t(`levels.${f.kind}`)}>
          <NativeSelect
            id="cov-unit"
            value={f.unitId}
            onChange={(e) => set("unitId", e.target.value)}
            className="w-full"
          >
            <option value="">{t("choose")}</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
    </>
  );
}

type Half = { f: Form; set: SetField; options: CoverageOptions; enabled: boolean };

export function TicketsHalf({ f, set, options, enabled }: Half) {
  const t = useTranslations("hrCoverage");
  return (
    <fieldset className="col-span-full grid gap-4 rounded-md border border-border p-3 sm:grid-cols-2">
      <legend className="px-1 text-sm font-medium">{t("ticketsHalf")}</legend>
      <Field id="cov-pair" label={t("pair")} hint={enabled ? undefined : t("ticketsOnly")}>
        <NativeSelect
          id="cov-pair"
          value={f.pairId}
          onChange={(e) => set("pairId", e.target.value)}
          disabled={!enabled}
          className="w-full"
        >
          <option value="">{t("noPair")}</option>
          {options.pairs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="cov-label" label={t("label")} hint={t("labelHint")}>
        <Input
          id="cov-label"
          value={f.label}
          disabled={!enabled}
          onChange={(e) => set("label", e.target.value)}
        />
      </Field>
      <Field
        id="cov-aliases"
        label={t("aliases")}
        hint={t("aliasesHint")}
        className="col-span-full"
      >
        <Input
          id="cov-aliases"
          value={f.aliases}
          disabled={!enabled}
          onChange={(e) => set("aliases", e.target.value)}
        />
      </Field>
    </fieldset>
  );
}

export function CasesHalf({ f, set, options, enabled }: Half) {
  const t = useTranslations("hrCoverage");
  const seats = [
    ["cov-owner", "owner"],
    ["cov-supervisor", "supervisor"],
  ] as const;
  return (
    <fieldset className="col-span-full grid gap-4 rounded-md border border-border p-3 sm:grid-cols-2">
      <legend className="px-1 text-sm font-medium">{t("casesHalf")}</legend>
      {seats.map(([id, key]) => (
        <Field key={id} id={id} label={t(key)} hint={enabled ? undefined : t("casesOnly")}>
          <NativeSelect
            id={id}
            value={f[key]}
            onChange={(e) => set(key, e.target.value)}
            disabled={!enabled}
            className="w-full"
          >
            <option value="">{t("nobody")}</option>
            {options.people
              .filter((p) => key === "owner" || p.supervises)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.email}
                </option>
              ))}
          </NativeSelect>
        </Field>
      ))}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t("caseTypes")}</span>
        <div className="flex flex-wrap gap-3">
          {CASE_TYPES.map((c) => (
            <Check
              key={c}
              id={`cov-type-${c}`}
              checked={f.caseTypes.includes(c)}
              disabled={!enabled}
              onChange={(on) =>
                set("caseTypes", on ? [...f.caseTypes, c] : f.caseTypes.filter((x) => x !== c))
              }
            >
              {t(`caseType.${c}`)}
            </Check>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("caseTypesHint")}</p>
      </div>
      <Field id="cov-priority" label={t("priority")} hint={t("priorityHint")}>
        <Input
          id="cov-priority"
          type="number"
          value={f.priority}
          disabled={!enabled}
          onChange={(e) => set("priority", e.target.value)}
        />
      </Field>
    </fieldset>
  );
}
