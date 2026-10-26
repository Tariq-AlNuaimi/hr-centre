"use client";

import { useTranslations } from "next-intl";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { SectionCard } from "@/components/shared/SectionCard";
import { LoadFailed, LoadingBlock } from "../States";
import { ExitActivation } from "./ExitActivation";
import { ExitDatesDialog } from "./ExitDatesDialog";
import { ExitDetailsDialog } from "./ExitDetailsDialog";
import { CLOSED_STATUSES, type ExitView } from "./types";
import { useExit } from "./use-exit";

/** The exit facts on the Overview tab, with every edit the source had only as an API (F6). */
export function ExitOverview({ caseId }: { caseId: string }) {
  const t = useTranslations("jml.leavers.overview");
  const q = useExit(caseId);
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <LoadFailed />;
  const x = q.data;
  const editable = x.can.manage && !CLOSED_STATUSES.has(x.status);
  return (
    <div className="space-y-6">
      {x.status === "DRAFT" ? <ExitActivation exit={x} /> : null}
      <SectionCard title={t("datesTitle")} actions={editable ? <ExitDatesDialog exit={x} /> : null}>
        <DatesList x={x} />
      </SectionCard>
      <SectionCard
        title={t("detailsTitle")}
        actions={editable ? <ExitDetailsDialog exit={x} /> : null}
      >
        <DetailsList x={x} />
      </SectionCard>
    </div>
  );
}

function DatesList({ x }: { x: ExitView }) {
  const t = useTranslations("jml.leavers.overview");
  const tv = useTranslations("jml.leavers.vocab");
  const dash = t("dash");
  return (
    <DescriptionList
      columns={2}
      items={[
        { key: "type", label: t("exitType"), value: tv(`exitType.${x.exitType}`) },
        ...(x.exitSubtype
          ? [{ key: "sub", label: t("exitSubtype"), value: tv(`exitSubtype.${x.exitSubtype}`) }]
          : []),
        { key: "nat", label: t("nationality"), value: tv(`nationality.${x.nationality}`) },
        { key: "ns", label: t("noticeStart"), value: x.noticeStartDate ?? dash },
        {
          key: "days",
          label: t("noticeDays"),
          value:
            x.noticePeriodDays === x.defaultNoticeDays
              ? String(x.noticePeriodDays)
              : t("noticeOverridden", {
                  days: x.noticePeriodDays,
                  reason: x.noticePeriodOverrideReason ?? dash,
                }),
        },
        { key: "lpwd", label: t("lpwd"), value: x.lastPhysicalWorkingDay ?? dash },
        { key: "lds", label: t("lds"), value: x.lastDayOfService ?? dash },
        ...(x.nationality === "EXPATRIATE"
          ? [{ key: "dep", label: t("departure"), value: x.departureDate ?? dash }]
          : []),
        {
          key: "early",
          label: t("earlyRelease"),
          value: x.earlyReleaseApproved ? t("yes") : t("no"),
        },
        {
          key: "login",
          label: t("loginRevoked"),
          value: x.loginRevokedAt?.slice(0, 10) ?? t("notYet"),
        },
        {
          key: "departed",
          label: t("departureApplied"),
          value: x.departureAppliedAt?.slice(0, 10) ?? t("notYet"),
        },
        ...(x.rekeyedAt
          ? [
              {
                key: "rekey",
                label: t("rekeyed"),
                value: `${x.rekeyedAt.slice(0, 10)} — ${x.rekeyReason ?? ""}`,
              },
            ]
          : []),
      ]}
    />
  );
}

function DetailsList({ x }: { x: ExitView }) {
  const t = useTranslations("jml.leavers.overview");
  const tv = useTranslations("jml.leavers.vocab");
  const tc = useTranslations("people.record.contract");
  const dash = t("dash");
  return (
    <DescriptionList
      columns={2}
      items={[
        { key: "job", label: t("jobTitle"), value: x.jobTitle ?? dash },
        { key: "grade", label: t("grade"), value: x.grade ?? dash },
        {
          key: "etype",
          label: t("employmentType"),
          value: x.employmentTypeAtExit ? tc(x.employmentTypeAtExit) : dash,
        },
        {
          key: "class",
          label: t("classification"),
          value: x.positionClassification ?? t("notRecorded"),
        },
        { key: "company", label: t("company"), value: x.entityName ?? dash },
        { key: "dept", label: t("department"), value: x.departmentName ?? dash },
        { key: "mgr", label: t("lineManager"), value: x.lineManager?.name ?? dash },
        {
          key: "settle",
          label: t("settlement"),
          value: x.settlementApplicable ? t("yes") : t("no"),
        },
        {
          key: "visa",
          label: t("visaSupport"),
          value: x.visaSupportApplicable ? t("yes") : t("no"),
        },
        { key: "backfill", label: t("backfill"), value: tv(`backfill.${x.backfillDecision}`) },
        ...(x.backfillApprovalRef
          ? [{ key: "bref", label: t("backfillRef"), value: x.backfillApprovalRef }]
          : []),
        {
          key: "rehire",
          label: t("rehire"),
          value: x.rehireEligible ? tv(`rehire.${x.rehireEligible}`) : t("notAssessed"),
        },
        ...(x.docRefPerformanceHistory || x.docRefWrittenGrounds || x.docRefLegalReview
          ? [
              { key: "d1", label: t("docPerf"), value: x.docRefPerformanceHistory ?? dash },
              { key: "d2", label: t("docGrounds"), value: x.docRefWrittenGrounds ?? dash },
              { key: "d3", label: t("docLegal"), value: x.docRefLegalReview ?? dash },
            ]
          : []),
        ...(x.migrated ? [{ key: "mig", label: t("migrated"), value: t("yes") }] : []),
      ]}
    />
  );
}
