"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { LoadFailed, LoadingBlock, NotPermitted } from "../States";
import { useJmlAccess, useJmlLookups, type Lookups } from "../use-jml";
import { ResolvePreview, RuleForm, type Rule } from "./RuleForm";

function unitName(l: Lookups, scope: Rule["scope"], id: string): string {
  const list =
    scope === "COMPANY" ? l.companies : scope === "DIRECTORATE" ? l.directorates : l.departments;
  return list.find((u) => u.id === id)?.name ?? id;
}

/**
 * HR owner assignment (Onboarding §14 / BR-002 — one model for all case types):
 * department beats directorate beats company, then priority, then oldest.
 */
export function RulesSettings() {
  const t = useTranslations("jml.settings.rules");
  const { can, isLoading } = useJmlAccess();
  const allowed = can("jml.configure");
  const lookups = useJmlLookups(allowed);
  const rules = useQuery({
    queryKey: ["jml", "rules"],
    queryFn: () =>
      apiClient.get<{ data: Rule[]; total: number }>("/api/jml/config/rules?pageSize=100"),
    enabled: allowed,
  });
  const [editing, setEditing] = useState<Rule | null>(null);
  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  if (isLoading || (allowed && (rules.isLoading || lookups.isLoading)))
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
  if (rules.isError || lookups.isError || !lookups.data)
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed />
      </div>
    );
  const l = lookups.data;
  const list = rules.data?.data ?? [];
  const blockers = [
    l.companies.length === 0 ? t("orgFirst") : null,
    l.hrUsers.length === 0 ? t("hrUsersFirst") : null,
  ].filter(Boolean);
  return (
    <div className="space-y-6">
      {header}
      {blockers.map((b) => (
        <p
          key={b}
          role="status"
          className="rounded-md border border-border bg-status-warn p-3 text-sm text-status-warn-fg"
        >
          {b}
        </p>
      ))}
      <SectionCard title={t("listTitle")} noBodyPadding>
        {list.length === 0 ? (
          <EmptyState description={t("empty")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("level")}</TableHead>
                <TableHead>{t("appliesTo")}</TableHead>
                <TableHead>{t("caseTypes")}</TableHead>
                <TableHead>{t("owner")}</TableHead>
                <TableHead>{t("senior")}</TableHead>
                <TableHead>{t("priority")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{t(`scope.${r.scope}`)}</TableCell>
                  <TableCell>{unitName(l, r.scope, r.scopeId)}</TableCell>
                  <TableCell>
                    {r.caseTypes.length === 0
                      ? t("allTypes")
                      : r.caseTypes.map((c) => t(`caseType.${c}`)).join(", ")}
                  </TableCell>
                  <TableCell>{r.juniorHr.name ?? r.juniorHr.email}</TableCell>
                  <TableCell>{r.seniorHr.name ?? r.seniorHr.email}</TableCell>
                  <TableCell>{r.priority}</TableCell>
                  <TableCell>
                    <Badge variant={r.active ? "success" : "default"}>
                      {r.active ? t("active") : t("inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                      {t("edit")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
      <RuleForm
        key={editing?.id ?? "new"}
        lookups={l}
        rule={editing}
        onDone={() => setEditing(null)}
      />
      <ResolvePreview lookups={l} />
    </div>
  );
}
