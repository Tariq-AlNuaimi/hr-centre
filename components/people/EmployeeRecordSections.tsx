import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptionList } from "@/components/shared/DescriptionList";
import type { EmployeeRecordView } from "@/lib/core/employee-select";

/**
 * The HR Centre record sections — blueprint §2 (F-b), one per record tab
 * (UX P1 R10). Each renders exactly what the
 * server's gated `select` returned: a missing `personal` / `idDocuments` group
 * is the query's decision (AC-F2.2/AC-F2.3), so there is no branch here that
 * could show a field the actor may not see.
 */
function useValue() {
  const t = useTranslations("people.record");
  return {
    t,
    value: (v: string | null) =>
      v ?? <span className="text-muted-foreground">{t("notOnFile")}</span>,
  };
}

/** Job details (Job & placement tab). */
export function JobSection({ record }: { record: EmployeeRecordView }) {
  const { t, value } = useValue();

  const job = [
    { key: "jobTitle", label: t("jobTitle"), value: value(record.jobTitle) },
    { key: "grade", label: t("grade"), value: value(record.grade) },
    {
      key: "contractType",
      label: t("contractType"),
      value: value(record.contractType ? t(`contract.${record.contractType}`) : null),
    },
    {
      key: "probationEndDate",
      label: t("probationEndDate"),
      value: value(record.probationEndDate),
    },
    { key: "workLocation", label: t("workLocation"), value: value(record.workLocation) },
    { key: "workPhone", label: t("workPhone"), value: value(record.workPhone) },
  ];

  return (
    <SectionCard title={t("jobSection")}>
      <DescriptionList items={job} columns={2} />
    </SectionCard>
  );
}

/** Personal details (Personal tab) — present only when the gated select returned them. */
export function PersonalSection({ record }: { record: EmployeeRecordView }) {
  const { t, value } = useValue();
  return (
    <>
      {record.personal ? (
        <SectionCard title={t("personalSection")} subtitle={t("personalNote")}>
          <DescriptionList
            columns={2}
            items={[
              {
                key: "personalEmail",
                label: t("personalEmail"),
                value: value(record.personal.personalEmail),
              },
              {
                key: "personalPhone",
                label: t("personalPhone"),
                value: value(record.personal.personalPhone),
              },
              {
                key: "dateOfBirth",
                label: t("dateOfBirth"),
                value: value(record.personal.dateOfBirth),
              },
              {
                key: "gender",
                label: t("gender"),
                value: value(
                  record.personal.gender ? t(`genderValue.${record.personal.gender}`) : null,
                ),
              },
              {
                key: "nationality",
                label: t("nationality"),
                value: value(record.personal.nationality),
              },
            ]}
          />
        </SectionCard>
      ) : null}
    </>
  );
}

/** Identity documents (Documents & IDs tab) — present only when the gated select returned them. */
export function IdSection({ record }: { record: EmployeeRecordView }) {
  const { t, value } = useValue();
  return (
    <>
      {record.idDocuments ? (
        <SectionCard title={t("idSection")} subtitle={t("idNote")}>
          {record.idDocuments.unavailable ? (
            <p role="alert" className="mb-4 text-sm text-destructive-emphasis">
              {t("idUnavailable")}
            </p>
          ) : null}
          <DescriptionList
            columns={2}
            items={[
              {
                key: "civilIdNumber",
                label: t("civilIdNumber"),
                value: <span className="font-mono">{value(record.idDocuments.civilIdNumber)}</span>,
              },
              {
                key: "civilIdExpiry",
                label: t("civilIdExpiry"),
                value: value(record.idDocuments.civilIdExpiry),
              },
              {
                key: "passportNumber",
                label: t("passportNumber"),
                value: (
                  <span className="font-mono">{value(record.idDocuments.passportNumber)}</span>
                ),
              },
              {
                key: "passportExpiry",
                label: t("passportExpiry"),
                value: value(record.idDocuments.passportExpiry),
              },
            ]}
          />
        </SectionCard>
      ) : null}
    </>
  );
}
