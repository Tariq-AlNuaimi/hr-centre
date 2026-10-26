"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/org/NativeSelect";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { CONTRACT_TYPES } from "@/lib/validations/people";
import { useState } from "react";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlAction } from "../use-jml";

type Config = {
  employmentType: string;
  active: boolean;
  defaultTemplateId: string | null;
  payrollApplicableDefault: boolean;
  notes: string | null;
};
type Template = { id: string; name: string; version: number; caseType: string };

/**
 * Per employment type (ADR-076's one list): offered on new joiners, suggested
 * template, payroll default, note — and the joiner form now READS them
 * (Onboarding 8.4.10). A type without a row behaves as the defaults.
 */
export function EmploymentTypesSettings() {
  const t = useTranslations("jml.settings.employmentTypes");
  const { can, isLoading } = useJmlAccess();
  const allowed = can("jml.configure");
  const configs = useQuery({
    queryKey: ["jml", "employment-types"],
    queryFn: () => apiClient.get<Config[]>("/api/jml/config/employment-types"),
    enabled: allowed,
  });
  const templates = useQuery({
    queryKey: ["jml", "templates", "JOIN"],
    queryFn: () =>
      apiClient.get<{ data: Template[] }>(
        "/api/jml/config/templates?caseType=JOIN&active=true&pageSize=100",
      ),
    enabled: allowed,
  });
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (isLoading || (allowed && configs.isLoading))
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
  if (configs.isError)
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed />
      </div>
    );
  const byType = new Map((configs.data ?? []).map((c) => [c.employmentType, c]));
  return (
    <div className="space-y-6">
      {header}
      <SectionCard
        title={t("listTitle")}
        subtitle={(configs.data ?? []).length === 0 ? t("noneConfigured") : undefined}
        noBodyPadding
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("type")}</TableHead>
              <TableHead>{t("offered")}</TableHead>
              <TableHead>{t("template")}</TableHead>
              <TableHead>{t("payroll")}</TableHead>
              <TableHead>{t("notes")}</TableHead>
              <TableHead>{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CONTRACT_TYPES.map((type) => (
              <TypeRow
                key={`${type}-${JSON.stringify(byType.get(type) ?? null)}`}
                type={type}
                config={byType.get(type)}
                templates={templates.data?.data ?? []}
              />
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </div>
  );
}

function TypeRow({
  type,
  config,
  templates,
}: {
  type: string;
  config?: Config;
  templates: Template[];
}) {
  const t = useTranslations("jml.settings.employmentTypes");
  const tp = useTranslations("people.record.contract");
  const { run, busy } = useJmlAction(t("saveFailed"));
  const [active, setActive] = useState(config?.active ?? true);
  const [templateId, setTemplateId] = useState(config?.defaultTemplateId ?? "");
  const [payroll, setPayroll] = useState(config?.payrollApplicableDefault ?? true);
  const [notes, setNotes] = useState(config?.notes ?? "");
  return (
    <TableRow>
      <TableCell className="font-medium">{tp(type)}</TableCell>
      <TableCell>
        <input
          type="checkbox"
          aria-label={t("offered")}
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      </TableCell>
      <TableCell>
        <NativeSelect
          aria-label={t("template")}
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">{t("noTemplate")}</option>
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {t("templateOption", { name: tpl.name, version: tpl.version })}
            </option>
          ))}
        </NativeSelect>
      </TableCell>
      <TableCell>
        <input
          type="checkbox"
          aria-label={t("payroll")}
          checked={payroll}
          onChange={(e) => setPayroll(e.target.checked)}
        />
      </TableCell>
      <TableCell>
        <Input aria-label={t("notes")} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </TableCell>
      <TableCell>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                apiClient.patch(`/api/jml/config/employment-types/${type}`, {
                  active,
                  defaultTemplateId: templateId || null,
                  payrollApplicableDefault: payroll,
                  notes: notes.trim() || null,
                }),
              t("saved"),
            )
          }
        >
          {t("save")}
        </Button>
      </TableCell>
    </TableRow>
  );
}
