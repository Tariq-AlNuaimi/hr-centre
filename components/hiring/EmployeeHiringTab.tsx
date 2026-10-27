import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { SectionCard } from "@/components/shared/SectionCard";
import { DescriptionList } from "@/components/shared/DescriptionList";
import { Badge } from "@/components/ui/badge";
import type { EmployeeHiring } from "@/lib/hiring/employee-tab";
import { formatZonedDay } from "@/lib/format";

/**
 * The employee record's "Hiring" tab: how this person was hired. Server
 * component — loaded and scope-checked by the page (lib/hiring/employee-tab.ts).
 */
export async function EmployeeHiringTab({
  data,
  locale,
}: {
  data: EmployeeHiring;
  locale: string;
}) {
  const t = await getTranslations("hiring.recordTab");
  const ts = await getTranslations("hiring.stage");
  const tsrc = await getTranslations("hiring.source");
  const tr = await getTranslations("hiring.round");
  // Calendar days in Muscat: a start date stored at local midnight is the previous UTC day.
  const day = (d: Date | null | undefined) => (d ? formatZonedDay(d) : "—");
  return (
    <div className="space-y-6">
      <SectionCard
        title={t("title")}
        actions={
          data.canOpen ? (
            <Link
              href={`/${locale}/hiring/candidates/${data.candidateId}`}
              className="text-sm text-primary-emphasis hover:underline"
            >
              {t("openCandidate")}
            </Link>
          ) : null
        }
      >
        <DescriptionList
          columns={2}
          items={[
            { key: "req", label: t("requisition"), value: data.requisition.title },
            { key: "source", label: t("source"), value: tsrc(data.source) },
            { key: "applied", label: t("applied"), value: day(data.appliedAt) },
            {
              key: "stage",
              label: t("stage"),
              value: <Badge variant="outline">{ts(data.stage)}</Badge>,
            },
            {
              key: "start",
              label: t("start"),
              value: day(data.offer?.joiningDate ?? data.offer?.startDate),
            },
            { key: "signed", label: t("signed"), value: day(data.offer?.signedAt) },
            {
              key: "handover",
              label: t("handover"),
              value: data.handover
                ? t(data.handover.kind === "TRANSFERRED" ? "handedTo" : "retained", {
                    name: data.handover.to ?? "—",
                    date: day(data.handover.completedAt),
                  })
                : t("noHandover"),
            },
          ]}
        />
      </SectionCard>
      <SectionCard title={t("pathTitle")}>
        {data.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noPath")}</p>
        ) : (
          <ol className="flex flex-wrap gap-2 text-sm">
            {data.history.map((h) => (
              <li key={h.id} className="rounded-md bg-muted px-2 py-1">
                {t("pathStep", { stage: ts(h.toStage), date: day(h.movedAt) })}
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
      <SectionCard title={t("interviewsTitle")}>
        {data.interviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noInterviews")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.interviews.map((i) => (
              <li key={i.id}>
                {t("interviewLine", { round: tr(i.round), date: day(i.scheduledDate) })}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
