"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { SectionCard } from "@/components/shared/SectionCard";
import { MoveSummary } from "../movers/MoveSummary";
import type { CaseDetail } from "./types";

/** Overview — the case header in full, the joiner's IT status, external systems. */
export function OverviewTab({ detail }: { detail: CaseDetail }) {
  const t = useTranslations("jml.case.overview");
  const tc = useTranslations("people.record.contract");
  const e = detail.employee;
  const j = detail.joinDetail;
  const dash = t("dash");
  const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : dash);
  const items = [
    { key: "code", label: t("employeeCode"), value: e.employeeCode ?? t("notIssued") },
    { key: "odoo", label: t("odooId"), value: e.odooId ?? t("notRecorded") },
    { key: "title", label: t("jobTitle"), value: e.jobTitle ?? dash },
    { key: "company", label: t("company"), value: e.entity.name },
    { key: "dir", label: t("directorate"), value: e.department?.directorate?.name ?? dash },
    { key: "dept", label: t("department"), value: e.department?.name ?? dash },
    { key: "etype", label: t("employmentType"), value: e.contractType ? tc(e.contractType) : dash },
    { key: "nat", label: t("nationality"), value: e.nationality ?? dash },
    { key: "mgr", label: t("lineManager"), value: e.manager?.name ?? dash },
    { key: "owner", label: t("hrOwner"), value: detail.hrOwner?.name ?? dash },
    { key: "senior", label: t("seniorHr"), value: detail.seniorHr?.name ?? dash },
    {
      key: "template",
      label: t("template"),
      value: detail.template
        ? t("templateValue", { name: detail.template.name, version: detail.template.version })
        : dash,
    },
    { key: "activated", label: t("activatedAt"), value: day(detail.activatedAt) },
    { key: "completed", label: t("completedAt"), value: day(detail.completedAt) },
    ...(detail.cancelReason
      ? [{ key: "cancel", label: t("cancelReason"), value: detail.cancelReason }]
      : []),
    ...(detail.duplicateOverrideReason
      ? [{ key: "dup", label: t("overrideReason"), value: detail.duplicateOverrideReason }]
      : []),
  ];
  return (
    <div className="space-y-6">
      <DescriptionList items={items} columns={2} />
      {j ? <JoinSummary j={j} /> : null}
      {detail.moveDetail ? <MoveSummary move={detail.moveDetail} /> : null}
      <SectionCard title={t("external")} subtitle={t("externalNote")}>
        <ul className="space-y-2 text-sm">
          {detail.externalLinks.map((l) => (
            <li key={l.key}>
              {l.url ? (
                <a
                  className="text-primary hover:underline"
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t(`link.${l.key}`)}
                </a>
              ) : (
                <span className="text-muted-foreground">
                  {t("linkMissing", { name: t(`link.${l.key}`) })}
                </span>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>
      {detail.caseType === "JOIN" ? (
        <Link href={`/jml/joiners/${detail.id}`} className="text-sm text-primary hover:underline">
          {t("editJoiner")}
        </Link>
      ) : null}
      <Link href={`/people/${e.id}`} className="ms-4 text-sm text-primary hover:underline">
        {t("openRecord")}
      </Link>
    </div>
  );
}

function JoinSummary({ j }: { j: NonNullable<CaseDetail["joinDetail"]> }) {
  const t = useTranslations("jml.case.overview");
  const dash = t("dash");
  const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : dash);
  const intake = j.itIntakeSubmittedAt
    ? t("intakeSent", { date: day(j.itIntakeSubmittedAt), ref: j.itIntakeReference ?? "" })
    : j.itIntakeError
      ? t("intakeFailed", { reason: j.itIntakeError })
      : t("intakeNone");
  return (
    <DescriptionList
      columns={2}
      items={[
        { key: "planned", label: t("plannedStart"), value: day(j.plannedStartDate) },
        { key: "actual", label: t("actualStart"), value: day(j.actualStartDate) },
        { key: "ctype", label: t("contractType"), value: j.contractType?.name ?? dash },
        { key: "payroll", label: t("payroll"), value: j.payrollApplicable ? t("yes") : t("no") },
        {
          key: "it",
          label: t("itReadiness"),
          value: j.itReadinessConfirmed
            ? t("itReadyOn", { date: day(j.itReadinessAt) })
            : t("itNotReady"),
        },
        { key: "intake", label: t("itIntake"), value: intake },
      ]}
    />
  );
}
