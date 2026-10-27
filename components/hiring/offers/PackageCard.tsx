"use client";

import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDate } from "@/lib/format";
import { bandVerdict, buildCompBreakdown } from "@/lib/hiring/offer-package";
import { omr, useAllowanceLabel } from "./bits";
import type { OfferDetail } from "./types";

const BAND_TONE = {
  WITHIN: "success",
  BELOW: "warning",
  ABOVE: "warning",
  NO_BAND: "default",
  NO_SALARY: "default",
} as const;

/**
 * The package (Interview Hub `OfferPackageCard`): basic, allowances, total
 * monthly with the band verdict, then the terms. A reader without comp access
 * sees "Restricted" — never an empty breakdown that reads as "nothing agreed".
 */
export function PackageCard({ o }: { o: OfferDetail }) {
  const t = useTranslations("hiring.offer");
  const label = useAllowanceLabel();
  const pay = buildCompBreakdown(o.salary, o.allowances);
  const band = bandVerdict(pay.basic, o.requisition.salaryBandMin, o.requisition.salaryBandMax);
  const title = o.requisition.grade
    ? t("titleWithGrade", { title: o.requisition.title, grade: o.requisition.grade })
    : o.requisition.title;
  const terms = [
    { k: "title", label: t("termTitle"), value: title },
    { k: "benefits", label: t("termBenefits"), value: o.benefits?.trim() || t("notRecorded") },
    { k: "contract", label: t("termContract"), value: o.contractType ?? "—" },
    { k: "probation", label: t("termProbation"), value: t("months", { n: o.probationMonths }) },
    { k: "notice", label: t("termNotice"), value: o.noticePeriod ?? "—" },
    { k: "start", label: t("termStart"), value: formatDate(o.startDate) },
  ];
  return (
    <SectionCard
      title={o.status === "PENDING_APPROVAL" ? t("packageUnderApproval") : t("currentOffer")}
    >
      <div className="space-y-4">
        <PayBlock o={o} pay={pay} label={label} />
        {!o.compHidden && pay.totalMonthly != null ? (
          <Badge variant={BAND_TONE[band]}>
            {t(`band.${band}`, {
              min: omr(o.requisition.salaryBandMin),
              max: omr(o.requisition.salaryBandMax),
            })}
          </Badge>
        ) : null}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {terms.map((x) => (
            <div key={x.k}>
              <dt className="text-xs text-muted-foreground">{x.label}</dt>
              <dd>{x.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </SectionCard>
  );
}

function PayBlock({
  o,
  pay,
  label,
}: {
  o: OfferDetail;
  pay: ReturnType<typeof buildCompBreakdown>;
  label: (k: string) => string;
}) {
  const t = useTranslations("hiring.offer");
  if (o.compHidden) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Lock className="h-4 w-4" aria-hidden />
        {t("restricted")}
      </p>
    );
  }
  if (o.payUnreadable) return <p className="text-sm text-status-warn-fg">{t("payUnreadable")}</p>;
  if (pay.rows.length === 0) return <p className="text-sm text-muted-foreground">{t("noPay")}</p>;
  return (
    <div>
      <dl className="divide-y divide-border">
        {pay.rows.map((r) => (
          <div key={r.key} className="flex items-baseline gap-3 py-2.5">
            <dt className={r.basic ? "flex-1 font-semibold" : "flex-1"}>{label(r.key)}</dt>
            <dd className="font-mono font-bold">{t("perMonth", { amount: omr(r.amount) })}</dd>
          </div>
        ))}
      </dl>
      {pay.totalMonthly != null ? (
        <div className="mt-3 flex items-center gap-3 rounded-md bg-accent-subtle px-4 py-3">
          <span className="flex-1 text-sm font-semibold">{t("totalMonthly")}</span>
          <span className="font-mono text-lg font-extrabold text-primary-emphasis">
            {omr(pay.totalMonthly)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
