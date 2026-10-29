"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { apiClient } from "@/lib/api-client";
import { HeadControl } from "./HeadControl";
import { UnitRow } from "./UnitRow";
import { useOrgAction } from "./useOrgAction";
import type { Company } from "./types";

/** Companies are rename-only — their codes are the import keys (blueprint §1). */
export function CompaniesSection({ companies }: { companies: Company[] }) {
  const t = useTranslations("org");
  const { run, busy } = useOrgAction(t("saveFailed"));

  return (
    <SectionCard title={t("companies")} subtitle={t("companiesNote")}>
      {companies.length === 0 ? (
        <EmptyState description={t("noCompanies")} />
      ) : (
        <ul>
          {companies.map((company) => (
            <UnitRow
              key={company.id}
              name={company.name}
              badge={<Badge variant="brand">{company.code}</Badge>}
              head={
                <HeadControl
                  kind="COMPANY"
                  unitId={company.id}
                  unitName={company.name}
                  head={company.head}
                />
              }
              meta={t("companyCounts", {
                departments: company._count.departments,
                people: company._count.employees,
              })}
              busy={busy}
              onRename={(name) =>
                run(
                  () => apiClient.patch(`/api/org/entities/${company.id}`, { name }),
                  t("renamed"),
                )
              }
            />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
