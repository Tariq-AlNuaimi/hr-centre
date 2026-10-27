import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { SectionCard } from "@/components/shared/SectionCard";
import { Badge } from "@/components/ui/badge";
import type { EmployeeJml } from "@/lib/jml/employee-tab";

/**
 * The employee record's "Joiners, movers & leavers" tab (F-e): this person's
 * cases, the assets they still hold and the access granted to them. Server
 * component — the data is loaded and scope-checked by the page.
 */
export async function EmployeeJmlTab({ data, locale }: { data: EmployeeJml; locale: string }) {
  const t = await getTranslations("jml.recordTab");
  const tv = await getTranslations("jml.vocab");
  const te = await getTranslations("jml.leavers.vocab");
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
  const dateOf = (c: EmployeeJml["cases"][number]) =>
    c.caseType === "JOIN"
      ? t("joinLine", {
          date: day(c.joinDetail?.actualStartDate ?? c.joinDetail?.plannedStartDate),
        })
      : c.caseType === "MOVE"
        ? t("moveLine", {
            change: c.moveDetail?.changeType ?? "",
            date: day(c.moveDetail?.effectiveDate),
          })
        : t("leaveLine", {
            type: c.leaveDetail?.exitType ?? "",
            date: day(c.leaveDetail?.lastDayOfService),
          });
  return (
    <div className="space-y-6">
      <SectionCard title={t("cases")}>
        {data.cases.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noCases")}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.cases.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/${locale}/jml/cases/${c.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {c.caseRef}
                </Link>
                <Badge variant="outline">{tv(`caseType.${c.caseType}`)}</Badge>
                <span>{dateOf(c)}</span>
                <span className="text-xs text-muted-foreground">
                  {t("statusLine", {
                    status: tv(`caseStatus.${c.status}`),
                    pct: c.completionPct,
                    owner: c.hrOwner?.name ?? "—",
                  })}
                </span>
                {c.leaveDetail?.migrated ? (
                  <Badge variant="outline">{t("historical")}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title={t("assets")}>
        {data.assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noAssets")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.assets.map((a) => (
              <li key={a.id}>
                {t("assetLine", {
                  type: a.assetType.label,
                  id: a.identifier ?? "—",
                  date: day(a.issuedDate),
                })}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title={t("access")}>
        {data.access.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noAccess")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.access.map((a) => (
              <li key={a.id}>
                {t("accessLine", { name: a.systemName, date: day(a.confirmedDate) })}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
