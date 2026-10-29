"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { ApiError, apiClient } from "@/lib/api-client";
import { CaseStatusBadge, Progress } from "../CaseBits";
import { CaseSummary, OpenCount } from "./CaseSummary";
import { LoadFailed, LoadingBlock, NotFoundBlock } from "../States";
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
import { TABS_FOR, tabFrom, type Tab } from "./tabs";

/**
 * One case, any type — Onboarding `/onboarding/[id]` with the fourth tab the
 * artifact asked for (Emails & notifications, §10.1) and a screen for every
 * action the sources only had as an API (8.4.6 / F6).
 */
export function CaseScreen({ caseId }: { caseId: string }) {
  const t = useTranslations("jml.case");
  const tv = useTranslations("jml.vocab");
  const search = useSearchParams();
  const [tab, setTab] = useState<Tab>(tabFrom(search.get("tab")));
  const detail = useQuery({
    queryKey: ["jml", "case", caseId],
    queryFn: () => apiClient.get<CaseDetail>(`/api/jml/cases/${caseId}`),
  });
  if (detail.isLoading) return <LoadingBlock />;
  // QA2 N-20 — a case that does not exist (or is out of scope) says so.
  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return <NotFoundBlock />;
  }
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
      <CaseSummary detail={c} />
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
            {key === "checklist" ? <OpenCount caseId={c.id} /> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="space-y-6">
        {shown === "checklist" ? <ChecklistTab detail={c} /> : null}
        {shown === "overview" ? (
          <>
            <OverviewTab detail={c} />
            {c.caseType === "LEAVE" ? <ApprovalsTab caseId={c.id} /> : null}
            {c.caseType === "LEAVE" ? <ComplianceTab caseId={c.id} status={c.status} /> : null}
          </>
        ) : null}
        {shown === "exit" ? (
          <>
            <InterviewTab caseId={c.id} exitType={c.exitType ?? ""} status={c.status} />
            <SettlementTab caseId={c.id} />
          </>
        ) : null}
        {shown === "documents" ? (
          <>
            {c.caseType === "LEAVE" ? <DocumentsTab caseId={c.id} status={c.status} /> : null}
            <RegisterTab detail={c} />
          </>
        ) : null}
        {shown === "activity" ? (
          <>
            <ActivityTab detail={c} />
            <EmailsTab detail={c} />
          </>
        ) : null}
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
