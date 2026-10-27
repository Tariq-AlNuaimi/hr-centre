"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { FilterSelect } from "@/components/shared/FilterBar";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatDay } from "@/lib/format";
import { AgeingBadge } from "./AgeingBadge";

type People = {
  drafters: Array<{ id: string; name: string }>;
  approvers: Array<{ id: string; name: string }>;
};
type Context = {
  employee: {
    id: string;
    name: string;
    jobTitle: string | null;
    grade: string | null;
    dateOfJoining: string | null;
    entity: { name: string };
    department: { name: string } | null;
    manager: { id: string; name: string } | null;
  } | null;
  openCaseType: "JOIN" | "MOVE" | "LEAVE" | null;
  recent: Array<{
    id: string;
    ticketNumber: number;
    status: string;
    question: string;
    createdAt: string;
  }>;
};

/** Whole years and months since a date, e.g. "3 years 2 months". Pure. */
function tenure(from: string, now = new Date()): { years: number; months: number } {
  const d = new Date(from);
  let months =
    (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + now.getUTCMonth() - d.getUTCMonth();
  if (now.getUTCDate() < d.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}

/**
 * The ticket's right rail (UX review tickets P1-2/P1-3): who owns it and by
 * when (internal), who may approve, and who is asking — so HR answers without
 * opening People in another tab.
 */
export function TicketRail({
  ticketId,
  status,
  dueAt,
  assignee,
  canDraft,
  ticketLabel,
}: {
  ticketId: string;
  status: string;
  dueAt: string | null;
  assignee: { id: string; name: string | null } | null;
  canDraft: boolean;
  ticketLabel: (n: number) => string;
}) {
  const t = useTranslations("hive.escalations.rail");
  const locale = useLocale();
  const { success, error } = useNotify();
  const queryClient = useQueryClient();
  const people = useQuery({
    queryKey: ["hive", "escalation", ticketId, "people"],
    queryFn: () => apiClient.get<People>(`/api/hive/escalations/${ticketId}/assignee`),
    enabled: canDraft,
    retry: false,
  });
  const context = useQuery({
    queryKey: ["hive", "escalation", ticketId, "context"],
    queryFn: () => apiClient.get<Context>(`/api/hive/escalations/${ticketId}/context`),
  });

  async function assign(assigneeId: string) {
    try {
      await apiClient.put(`/api/hive/escalations/${ticketId}/assignee`, {
        assigneeId: assigneeId || null,
      });
      success(assigneeId ? t("assigned") : t("unassignedNow"));
      await queryClient.invalidateQueries({ queryKey: ["hive"] });
    } catch (e) {
      error(e instanceof ApiError ? e.message : t("assignFailed"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title={t("ownership")}>
        <div className="flex flex-col gap-3 text-sm">
          {canDraft && people.data ? (
            <FilterSelect
              id="ticket-assignee"
              label={t("assignee")}
              allLabel={t("nobody")}
              value={assignee?.id ?? ""}
              onChange={(v) => void assign(v)}
              options={people.data.drafters.map((d) => ({ value: d.id, label: d.name }))}
            />
          ) : (
            <p className="m-0">
              <span className="text-muted-foreground">{t("assignee")}: </span>
              {assignee?.name ?? t("nobody")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{t("answerBy")}</span>
            {dueAt ? <AgeingBadge dueAt={dueAt} status={status} /> : <span>{t("noClock")}</span>}
          </div>
          {people.data ? (
            <p className="m-0">
              <span className="text-muted-foreground">{t("approvers")}: </span>
              {people.data.approvers.length > 0
                ? people.data.approvers.map((a) => a.name).join(", ")
                : t("noApprovers")}
            </p>
          ) : null}
        </div>
      </SectionCard>

      <EmployeeCard context={context} />

      <SectionCard title={t("recent")}>
        {(context.data?.recent ?? []).length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">{t("noRecent")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            {context.data!.recent.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/${locale}/tickets/${r.id}`}
                  className="font-mono text-xs text-primary-emphasis underline-offset-4 hover:underline"
                >
                  {ticketLabel(r.ticketNumber)}
                </Link>{" "}
                <span className="text-xs text-muted-foreground">{formatDay(r.createdAt)}</span>
                <div className="truncate text-muted-foreground">{r.question}</div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function EmployeeCard({
  context,
}: {
  context: { isLoading: boolean; isError: boolean; data?: Context };
}) {
  const t = useTranslations("hive.escalations.rail");
  const locale = useLocale();
  const e = context.data?.employee;
  const tenureNow = e?.dateOfJoining ? tenure(e.dateOfJoining) : null;
  return (
    <SectionCard title={t("employee")}>
      {context.isLoading ? (
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      ) : context.isError ? (
        <p className="m-0 text-sm text-destructive-emphasis">{t("contextFailed")}</p>
      ) : !e ? (
        <p className="m-0 text-sm text-muted-foreground">{t("noRecord")}</p>
      ) : (
        <DescriptionList
          columns={1}
          size="small"
          bordered={false}
          items={[
            {
              key: "name",
              label: t("name"),
              value: (
                <Link
                  href={`/${locale}/people/${e.id}`}
                  className="text-primary-emphasis underline-offset-4 hover:underline"
                >
                  {e.name}
                </Link>
              ),
            },
            {
              key: "placement",
              label: t("placement"),
              value: [e.jobTitle, e.department?.name, e.entity.name].filter(Boolean).join(" · "),
            },
            { key: "manager", label: t("manager"), value: e.manager?.name ?? "—" },
            { key: "grade", label: t("grade"), value: e.grade ?? "—" },
            {
              key: "tenure",
              label: t("tenure"),
              value: tenureNow ? t("tenureValue", tenureNow) : "—",
            },
            ...(context.data?.openCaseType
              ? [
                  {
                    key: "case",
                    label: t("openCase"),
                    value: t(`caseType.${context.data.openCaseType}`),
                  },
                ]
              : []),
          ]}
        />
      )}
    </SectionCard>
  );
}
