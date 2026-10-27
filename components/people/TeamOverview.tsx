"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { apiClient } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { useHiringMe } from "@/components/hiring/ui/api";

type Overview = {
  reports: Record<string, number>;
  cases: Array<{
    id: string;
    type: "JOIN" | "MOVE" | "LEAVE";
    employee: { id: string; name: string };
    keyDate: string | null;
  }>;
  openRequisitions: number;
};

/**
 * "My team" across HR Centre (UX review R14): who reports to me, who is
 * joining, moving or leaving, and the hiring requests I own — above the
 * Performance roster. Each line links to the record or the module.
 */
export function TeamOverview({ orgScope = false }: { orgScope?: boolean }) {
  // HR at org scope line-manages nobody; the roster below is the whole org.
  return orgScope ? null : <Overview />;
}

function Overview() {
  const me = useHiringMe();
  const canHire = me.has("hiring.hiringManager") || me.has("hiring.manage");
  const t = useTranslations("team.overview");
  const locale = useLocale();
  const q = useQuery({
    queryKey: ["team", "overview"],
    queryFn: () => apiClient.get<Overview>("/api/team/overview"),
    staleTime: 60_000,
  });
  if (q.isLoading) return <div className="h-28 animate-pulse rounded-md bg-muted" />;
  if (q.isError || !q.data)
    return (
      <p role="alert" className="text-sm text-destructive-emphasis">
        {t("loadFailed")}
      </p>
    );
  const { reports, cases, openRequisitions } = q.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title={t("reports")} value={reports.ACTIVE ?? 0} hint={t("reportsHint")} />
        <StatCard
          title={t("joiningSoon")}
          value={(reports.PRE_JOINER ?? 0) + cases.filter((c) => c.type === "JOIN").length}
          hint={t("joiningHint")}
        />
        {canHire ? (
          <Link
            href={`/${locale}/team/hiring`}
            className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StatCard
              title={t("openRequisitions")}
              value={openRequisitions}
              hint={t("openRequisitionsHint")}
            />
          </Link>
        ) : (
          <StatCard
            title={t("leaving")}
            value={cases.filter((c) => c.type === "LEAVE").length}
            hint={t("leavingHint")}
          />
        )}
      </div>
      <SectionCard title={t("casesTitle")} subtitle={t("casesNote")}>
        {cases.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">{t("noCases")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            {cases.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/${locale}/people/${c.employee.id}`}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {c.employee.name}
                </Link>
                <span className="text-muted-foreground">
                  {t(`caseType.${c.type}`)}
                  {c.keyDate ? ` · ${t(`keyDate.${c.type}`, { date: formatDate(c.keyDate) })}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
