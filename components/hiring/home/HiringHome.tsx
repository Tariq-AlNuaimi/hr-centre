"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatCard } from "@/components/shared/StatCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { qs, useHiringMe, useHiringQuery } from "../ui/api";
import { StatusBadge } from "../ui/badges";
import type { RequisitionRow } from "../requisitions/RequisitionList";

/**
 * Hiring home — the work inbox (Interview Hub `WorkInbox`): what is waiting on
 * the people who run hiring. Grows with each slice (interviews to score,
 * offers to approve, handovers).
 */
type List = { data: RequisitionRow[]; total: number };

export function HiringHome() {
  const t = useTranslations("hiring.home");
  const locale = useLocale();
  const { has } = useHiringMe();
  const pending = useHiringQuery<List>(
    `/api/hiring/requisitions${qs({ status: "PENDING_APPROVAL", pageSize: 5 })}`,
  );
  const jd = useHiringQuery<List>(
    `/api/hiring/requisitions${qs({ jdStatus: "AWAITING_SIGNOFF", pageSize: 5 })}`,
  );
  const open = useHiringQuery<List>(
    `/api/hiring/requisitions${qs({ status: "OPEN", pageSize: 5 })}`,
  );
  const base = `/${locale}/hiring/requisitions`;
  const section = (title: string, list: List | undefined, suffix: string) => (
    <SectionCard title={title}>
      {list?.data.length ? (
        <ul className="space-y-2 text-sm">
          {list.data.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <Link
                className="text-primary-emphasis hover:underline"
                href={`${base}/${r.id}${suffix}`}
              >
                {r.title}
              </Link>
              <StatusBadge kind="requisition" value={r.status} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState description={t("nothing")} />
      )}
    </SectionCard>
  );
  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {!has("hiring.view") ? <EmptyState description={t("noAccess")} /> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title={t("awaitingApproval")} value={pending.data?.total ?? "—"} />
        <StatCard title={t("awaitingJd")} value={jd.data?.total ?? "—"} />
        <StatCard title={t("open")} value={open.data?.total ?? "—"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {section(t("awaitingApproval"), pending.data, "/approval")}
        {section(t("awaitingJd"), jd.data, "/jd")}
        {section(t("open"), open.data, "")}
      </div>
    </div>
  );
}
