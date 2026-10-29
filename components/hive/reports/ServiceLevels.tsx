"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BarChart } from "@/components/shared/Chart";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";

/**
 * P2-10 — the service-level half of the ticket reports: first response vs
 * resolution vs the answer-by target, approval turnaround, backlog trend,
 * ageing and per-person load. Every count links to the queue, filtered to the
 * tickets behind it.
 */

export type ServiceLevelData = {
  range: { from: string; to: string };
  sla: {
    medianFirstResponseHours: number | null;
    medianResolutionHours: number | null;
    medianApprovalHours: number | null;
    answeredOnTime: number;
    answeredLate: number;
    answeredNoTarget: number;
  };
  backlog: { bucket: string; open: number }[];
  ageing: { band: string; count: number }[];
  people: { userId: string; name: string; open: number; overdue: number; answered: number }[];
};

export function ServiceLevels({
  data,
  duration,
  day,
  number,
}: {
  data: ServiceLevelData;
  duration: (hours: number | null) => string;
  day: (iso: string) => string;
  number: Intl.NumberFormat;
}) {
  const t = useTranslations("hive.reports.sla");
  const { sla } = data;
  const targeted = sla.answeredOnTime + sla.answeredLate;
  const onTimePct = targeted ? Math.round((sla.answeredOnTime / targeted) * 100) : null;
  const backlogKey = t("openTickets");

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title={t("firstResponse")}
          value={duration(sla.medianFirstResponseHours)}
          hint={t("medianHint")}
        />
        <StatCard
          title={t("resolution")}
          value={duration(sla.medianResolutionHours)}
          hint={t("medianHint")}
        />
        <StatCard
          title={t("onTime")}
          value={onTimePct === null ? "—" : `${onTimePct}%`}
          hint={t("onTimeHint", {
            onTime: sla.answeredOnTime,
            late: sla.answeredLate,
            none: sla.answeredNoTarget,
          })}
        />
        <StatCard
          title={t("approval")}
          value={duration(sla.medianApprovalHours)}
          hint={t("approvalHint")}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard
          title={t("backlog")}
          subtitle={t("backlogHint")}
          style={{ gridColumn: "span 2" }}
        >
          <BarChart
            data={data.backlog.map((b) => ({ x: day(b.bucket), [backlogKey]: b.open }))}
            yKey={backlogKey}
            integer
            height={240}
          />
        </SectionCard>
        <SectionCard title={t("ageing")} subtitle={t("ageingHint")}>
          <ul className="m-0 list-none space-y-2 p-0 text-sm">
            {data.ageing.map((a) => (
              <li key={a.band} className="flex items-baseline justify-between gap-3">
                <span>{t(`age.${a.band}`)}</span>
                <span className="font-medium tabular-nums">{number.format(a.count)}</span>
              </li>
            ))}
          </ul>
          <Link
            href={{ pathname: "/tickets", query: { view: "overdue" } }}
            className="mt-3 inline-block text-sm text-primary hover:underline"
          >
            {t("openOverdue")}
          </Link>
        </SectionCard>
      </div>

      <SectionCard title={t("people")} subtitle={t("peopleHint")} noBodyPadding>
        {data.people.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("noPeople")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th scope="col" className="p-3 text-start font-medium">
                  {t("person")}
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  {t("openNow")}
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  {t("overdueNow")}
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  {t("answeredInRange")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.userId} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <Link
                      href={{ pathname: "/tickets", query: { assigneeId: p.userId } }}
                      className="text-primary hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="p-3 text-end tabular-nums">{number.format(p.open)}</td>
                  <td className="p-3 text-end tabular-nums">{number.format(p.overdue)}</td>
                  <td className="p-3 text-end tabular-nums">{number.format(p.answered)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </>
  );
}
