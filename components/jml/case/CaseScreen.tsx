"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { apiClient } from "@/lib/api-client";
import { CaseStatusBadge, Progress } from "../CaseBits";
import { LoadFailed, LoadingBlock } from "../States";
import { CaseActions } from "./CaseActions";
import { ChecklistTab } from "./ChecklistTab";
import { EmailsTab } from "./EmailsTab";
import { OverviewTab } from "./OverviewTab";
import { RegisterTab } from "./RegisterTab";
import { ApprovalsTab } from "../leavers/ApprovalsTab";
import { ComplianceTab } from "../leavers/ComplianceTab";
import { InterviewTab } from "../leavers/InterviewTab";
import { SettlementTab } from "../leavers/SettlementTab";
import { DocumentsTab } from "../leavers/DocumentsTab";
import type { CaseDetail } from "./types";

const TABS = [
  "checklist",
  "overview",
  "approvals",
  "compliance",
  "interview",
  "settlement",
  "documents",
  "register",
  "emails",
  "activity",
] as const;
type Tab = (typeof TABS)[number];

/** Approvals and compliance are leaver-only; the register serves joiners (issue) and leavers (return). */
const TABS_FOR: Record<CaseDetail["caseType"], readonly Tab[]> = {
  JOIN: ["checklist", "overview", "register", "emails", "activity"],
  MOVE: ["checklist", "overview", "emails", "activity"],
  LEAVE: [
    "checklist",
    "overview",
    "approvals",
    "compliance",
    "interview",
    "settlement",
    "documents",
    "register",
    "emails",
    "activity",
  ],
};

/**
 * One case, any type — Onboarding `/onboarding/[id]` with the fourth tab the
 * artifact asked for (Emails & notifications, §10.1) and a screen for every
 * action the sources only had as an API (8.4.6 / F6).
 */
export function CaseScreen({ caseId }: { caseId: string }) {
  const t = useTranslations("jml.case");
  const tv = useTranslations("jml.vocab");
  const search = useSearchParams();
  const initial = (search.get("tab") as Tab | null) ?? "checklist";
  const [tab, setTab] = useState<Tab>(TABS.includes(initial) ? initial : "checklist");
  const detail = useQuery({
    queryKey: ["jml", "case", caseId],
    queryFn: () => apiClient.get<CaseDetail>(`/api/jml/cases/${caseId}`),
  });
  if (detail.isLoading) return <LoadingBlock />;
  if (detail.isError || !detail.data) return <LoadFailed />;
  const c = detail.data;
  const tabs = TABS_FOR[c.caseType];
  const shown: Tab = tabs.includes(tab) ? tab : "checklist";
  return (
    <div className="space-y-6">
      <PageHeader
        title={c.employee.name}
        subtitle={t("subtitle", {
          ref: c.caseRef,
          type: tv(`caseType.${c.caseType}`),
          stage: tv(`stage.${c.stage}`),
        })}
        actions={
          <div className="flex items-center gap-3">
            <Progress value={c.completionPct} />
            <CaseStatusBadge status={c.status} />
          </div>
        }
      />
      {search.get("activated") ? (
        <p role="status" className="rounded-md bg-status-ok p-3 text-sm text-status-ok-fg">
          {t("activatedNote", { code: c.employee.employeeCode ?? "" })}
        </p>
      ) : null}
      {c.legalHold ? (
        <p role="status" className="rounded-md bg-status-warn p-3 text-sm text-status-warn-fg">
          {t("onHold", { reason: c.legalHoldReason ?? "" })}
        </p>
      ) : null}
      <CaseActions detail={c} />
      <div role="tablist" aria-label={t("tabs")} className="flex gap-1 border-b border-border">
        {tabs.map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={shown === key}
            onClick={() => setTab(key)}
            className={
              shown === key
                ? "border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground"
                : "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {t(`tab.${key}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {shown === "checklist" ? <ChecklistTab detail={c} /> : null}
        {shown === "overview" ? <OverviewTab detail={c} /> : null}
        {shown === "approvals" ? <ApprovalsTab caseId={c.id} /> : null}
        {shown === "compliance" ? <ComplianceTab caseId={c.id} status={c.status} /> : null}
        {shown === "interview" ? (
          <InterviewTab caseId={c.id} exitType={c.exitType ?? ""} status={c.status} />
        ) : null}
        {shown === "settlement" ? <SettlementTab caseId={c.id} /> : null}
        {shown === "documents" ? <DocumentsTab caseId={c.id} status={c.status} /> : null}
        {shown === "register" ? <RegisterTab detail={c} /> : null}
        {shown === "emails" ? <EmailsTab detail={c} /> : null}
        {shown === "activity" ? <ActivityTab detail={c} /> : null}
      </div>
    </div>
  );
}

type ActivityRow = {
  id: string;
  at: string;
  action: string;
  entityType: string;
  subject: string | null;
  fields: string[];
  actor: string | null;
};

function ActivityTab({ detail }: { detail: CaseDetail }) {
  const ta = useTranslations("jml.case.activity");
  const rows = useQuery({
    queryKey: ["jml", "case", detail.id, "activity"],
    queryFn: () => apiClient.get<ActivityRow[]>(`/api/jml/cases/${detail.id}/activity`),
  });
  if (rows.isLoading) return <LoadingBlock />;
  if (rows.isError || !rows.data) return <LoadFailed />;
  if (rows.data.length === 0) return <p className="text-sm text-muted-foreground">{ta("empty")}</p>;
  return (
    <ol className="space-y-2">
      {rows.data.map((r) => (
        <li key={r.id} className="rounded-md border border-border p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-medium text-foreground">
              {ta(`action.${r.action}`)} {r.subject ?? ta(`entity.${r.entityType}`)}
            </span>
            <span className="text-xs text-muted-foreground">
              {ta("byAt", {
                who: r.actor ?? ta("system"),
                at: r.at.slice(0, 16).replace("T", " "),
              })}
            </span>
          </div>
          {r.fields.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {ta("fields", { list: r.fields.join(", ") })}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
