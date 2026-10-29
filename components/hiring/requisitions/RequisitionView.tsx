"use client";

import { placeLabel } from "@/lib/hiring/careers-jd";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { AiInsightCard } from "../ai/AiInsightCard";
import { formatDate } from "@/lib/format";
import { formatBand } from "@/lib/hiring/money";
import { useHiringQuery } from "../ui/api";
import { StatusBadge } from "../ui/badges";
import { useCrumb } from "../ui/crumb";
import { QueryState } from "../ui/states";
import { Tabs } from "@/components/shared/UrlTabs";
import { AuditTrail } from "./AuditTrail";
import { CareersToggle } from "./CareersToggle";
import { StatusCard } from "./StatusCard";
import type { RequisitionDetail } from "./types";

/** One requisition (Interview Hub `/positions/[id]`): overview, kit, activity, the flow. */
export function RequisitionView({ id }: { id: string }) {
  const t = useTranslations("hiring.requisition");
  const router = useRouter();
  const locale = useLocale();
  const {
    data: r,
    isLoading,
    error,
    refetch,
  } = useHiringQuery<RequisitionDetail>(`/api/hiring/requisitions/${id}`);
  const base = `/${locale}/hiring/requisitions/${id}`;
  useCrumb(id, r?.title);
  return (
    <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()}>
      {r ? (
        <div className="space-y-4">
          <PageHeader
            title={r.title}
            subtitle={[r.departmentName, r.entity?.name].filter(Boolean).join(" · ")}
            actions={
              <>
                <StatusBadge kind="requisition" value={r.status} />
                {r.can.manage ? <CareersToggle req={r} /> : null}
                {r.can.manage ? (
                  <Button variant="outline" onClick={() => router.push(`${base}/edit`)}>
                    <Pencil className="h-4 w-4" />
                    {t("edit")}
                  </Button>
                ) : null}
              </>
            }
          />
          <FlowLinks base={base} req={r} />
          <Tabs
            tabs={[
              { key: "overview", label: t("tabOverview"), content: <Overview r={r} /> },
              {
                key: "kit",
                label: t("tabKit"),
                content: (
                  <div className="space-y-4">
                    <Kit r={r} base={base} />
                    <AiInsightCard kind="jd" entityId={r.id} canRun={r.can.manage} />
                  </div>
                ),
              },
              {
                key: "activity",
                label: t("tabActivity"),
                content: (
                  <div className="space-y-4">
                    <StatusCard req={r} />
                    <AuditTrail id={r.id} />
                  </div>
                ),
              },
            ]}
          />
        </div>
      ) : null}
    </QueryState>
  );
}

function FlowLinks({ base, req }: { base: string; req: RequisitionDetail }) {
  const t = useTranslations("hiring.requisition");
  const links = [
    { href: `${base}/approval`, label: t("flowApproval"), show: true },
    { href: `${base}/jd`, label: t("flowJd"), show: true },
    { href: `${base}/posting`, label: t("flowPosting"), show: req.can.manage },
    { href: `${base}/pipeline`, label: t("flowPipeline"), show: req.can.manage },
    { href: `${base}/screening`, label: t("flowScreening"), show: req.can.manage },
    { href: `${base}/assessment`, label: t("flowAssessment"), show: req.can.manage },
    { href: `${base}/interviews`, label: t("flowInterviews"), show: true },
    { href: `${base}/comparison`, label: t("flowComparison"), show: req.can.manage },
  ];
  return (
    <nav aria-label={t("flowNav")} className="flex flex-wrap gap-2">
      {links
        .filter((l) => l.show)
        .map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            {l.label}
          </Link>
        ))}
    </nav>
  );
}

function Overview({ r }: { r: RequisitionDetail }) {
  const t = useTranslations("hiring.requisition");
  const dash = (v: string | null | undefined) => v || "—";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title={t("roleTitle")}>
        <DescriptionList
          columns={1}
          items={[
            { key: "hm", label: t("hiringManager"), value: dash(r.hiringManager?.name) },
            { key: "owner", label: t("owner"), value: r.owner?.name ?? t("ownerUnassigned") },
            { key: "grade", label: t("grade"), value: dash(r.grade) },
            {
              key: "location",
              label: t("location"),
              value: `${placeLabel({ city: r.locationCity, country: r.locationCountry })} · ${t(
                `arrangement.${r.workArrangement}`,
              )}`,
            },
            { key: "openings", label: t("openings"), value: r.fillLabel },
            {
              key: "close",
              label: t("targetClose"),
              value: r.targetCloseDate ? formatDate(r.targetCloseDate) : "—",
            },
          ]}
        />
      </SectionCard>
      <SectionCard title={t("compTitle")}>
        <DescriptionList
          columns={1}
          items={[
            {
              key: "band",
              label: t("band"),
              value: r.bandHidden
                ? t("bandHidden")
                : formatBand(r.salaryBandMin, r.salaryBandMax, r.salaryCurrency),
            },
            {
              key: "vis",
              label: t("payVisibility"),
              value: r.hmSeesSalary ? t("hmSeesSalaryYes") : t("hmSeesSalaryNo"),
            },
          ]}
        />
      </SectionCard>
      <SectionCard title={t("businessTitle")}>
        <DescriptionList
          columns={1}
          items={[
            {
              key: "need",
              label: t("businessNeed"),
              value: <span className="whitespace-pre-wrap">{dash(r.businessNeed)}</span>,
            },
            {
              key: "alt",
              label: t("alternatives"),
              value: <span className="whitespace-pre-wrap">{dash(r.alternativesConsidered)}</span>,
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}

function Kit({ r, base }: { r: RequisitionDetail; base: string }) {
  const t = useTranslations("hiring.requisition");
  return (
    <SectionCard
      title={t("kitTitle")}
      actions={
        <Link href={`${base}/jd`} className="text-sm text-primary-emphasis hover:underline">
          {t("openJd")}
        </Link>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <StatusBadge kind="jd" value={r.jdStatus} />
        <span className="text-sm text-muted-foreground">
          {r.liveOnCareers ? t("onCareers") : t("notOnCareers")}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground">{r.description || t("noJd")}</p>
      <p className="mt-3 text-sm text-muted-foreground">{r.competencies.join(" · ")}</p>
    </SectionCard>
  );
}
