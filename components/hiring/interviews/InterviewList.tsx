"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CalendarDays, Download, ListChecks, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { NativeSelect } from "@/components/org/NativeSelect";
import { INTERVIEW_STATUSES } from "@/lib/validations/hiring/interview";
import { qs, useHiringMe, useHiringMutation, useHiringQuery } from "../ui/api";
import { QueryState } from "../ui/states";
import { FilterChips } from "../candidates/FilterChips";
import { MonthCalendar } from "./MonthCalendar";
import { ScheduleList } from "./ScheduleList";
import type { InterviewRow } from "./types";

/** `/hiring/interviews` (Interview Hub `InterviewsListClient`): day-grouped list or month calendar. */
export function InterviewList() {
  const t = useTranslations("hiring.interviews");
  const ts = useTranslations("hiring.interviewStatus");
  const router = useRouter();
  const locale = useLocale();
  const { has } = useHiringMe();
  const manage = has("hiring.manage");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [page, setPage] = useState(1);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    const h = setTimeout(() => {
      if (searchInput.trim() !== search) {
        setSearch(searchInput.trim());
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(h);
  }, [searchInput, search]);
  const pageSize = view === "calendar" ? 100 : 50;
  const { data, isLoading, error, refetch } = useHiringQuery<{
    data: InterviewRow[];
    total: number;
  }>(`/api/hiring/interviews${qs({ page, pageSize, search, status })}`);
  const remove = useHiringMutation<{ id: string }>(
    "DELETE",
    (b) => `/api/hiring/interviews/${b.id}`,
    {
      success: t("deleted"),
    },
  );
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const upcoming = rows.filter((r) => new Date(r.scheduledDate).getTime() >= now).length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={total ? t("subtitle", { count: total, upcoming }) : undefined}
        actions={
          <>
            <a
              className={buttonVariants({ variant: "outline" })}
              href={`/api/hiring/interviews/calendar${qs({ status })}`}
            >
              <CalendarDays className="h-4 w-4" />
              {t("exportCalendar")}
            </a>
            {manage ? (
              <>
                <a
                  className={buttonVariants({ variant: "outline" })}
                  href={`/api/hiring/interviews/export${qs({ status })}`}
                >
                  <Download className="h-4 w-4" />
                  {t("export")}
                </a>
                <Button
                  variant="outline"
                  onClick={() => router.push(`/${locale}/hiring/evaluations`)}
                >
                  <ListChecks className="h-4 w-4" />
                  {t("scorecards")}
                </Button>
                <Button onClick={() => router.push(`/${locale}/hiring/interviews/new`)}>
                  <Plus className="h-4 w-4" />
                  {t("schedule")}
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-72"
            aria-label={t("search")}
            placeholder={t("search")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <NativeSelect
            aria-label={t("statusFilter")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("allStatuses")}</option>
            {INTERVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <FilterChips
          label={t("viewLabel")}
          active={view}
          onSelect={(v) => {
            setView(v);
            setPage(1);
          }}
          options={[
            { value: "list" as const, label: t("viewList") },
            { value: "calendar" as const, label: t("viewCalendar") },
          ]}
        />
      </div>
      <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()}>
        {view === "list" ? (
          <ScheduleList
            rows={rows}
            onDelete={manage ? (id) => remove.mutate({ id }) : undefined}
            empty={
              <EmptyState
                description={t("empty")}
                actionLabel={manage ? t("schedule") : undefined}
                onAction={() => router.push(`/${locale}/hiring/interviews/new`)}
                actionVariant="outline"
              />
            }
          />
        ) : (
          <MonthCalendar rows={rows} />
        )}
      </QueryState>
      {pages > 1 ? (
        <nav aria-label={t("pagination")} className="flex items-center justify-end gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t("previous")}
          </Button>
          <span>{t("pageOf", { page, pages })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t("next")}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
