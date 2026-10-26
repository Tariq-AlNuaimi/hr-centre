"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { apiClient } from "@/lib/api-client";
import { CompaniesSection } from "./CompaniesSection";
import { DirectoratesSection } from "./DirectoratesSection";
import { DepartmentsSection } from "./DepartmentsSection";
import { TeamsSection } from "./TeamsSection";
import type { Company, Department, Directorate, Team } from "./types";

/**
 * Organisation admin — blueprint §1 (F-a). Settings archetype: four stacked
 * sections, top of the hierarchy first, because each level's form picks its
 * parent from the one above.
 *
 * The lists are bounded server-side (companies 100, directorates 200,
 * departments and teams one page of 100) — the real org is a few dozen units.
 */
export function OrgSetup() {
  const t = useTranslations("org");
  const { capabilities, isLoading: actorLoading } = usePmsActor();
  const allowed = capabilities.configure;

  const companies = useQuery({
    queryKey: ["org", "companies"],
    queryFn: () => apiClient.get<Company[]>("/api/org/entities"),
    enabled: allowed,
  });
  const directorates = useQuery({
    queryKey: ["org", "directorates"],
    queryFn: () => apiClient.get<Directorate[]>("/api/org/directorates"),
    enabled: allowed,
  });
  const departments = useQuery({
    queryKey: ["org", "departments"],
    queryFn: () => apiClient.get<{ data: Department[] }>("/api/org/departments?pageSize=100"),
    enabled: allowed,
  });
  const teams = useQuery({
    queryKey: ["org", "teams"],
    queryFn: () => apiClient.get<{ data: Team[] }>("/api/org/teams?pageSize=100"),
    enabled: allowed,
  });

  const header = <PageHeader title={t("title")} subtitle={t("subtitle")} />;
  const queries = [companies, directorates, departments, teams];

  if (actorLoading || (allowed && queries.some((q) => q.isLoading))) {
    return (
      <div className="space-y-6">
        {header}
        <SectionCard title={t("companies")}>
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        </SectionCard>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="space-y-6">
        {header}
        <SectionCard title={t("companies")}>
          <EmptyState description={t("notPermitted")} />
        </SectionCard>
      </div>
    );
  }

  if (queries.some((q) => q.isError)) {
    return (
      <div className="space-y-6">
        {header}
        <SectionCard title={t("companies")}>
          <p role="alert" className="text-sm text-destructive-emphasis">
            {t("loadFailed")}
          </p>
        </SectionCard>
      </div>
    );
  }

  const companyList = companies.data ?? [];
  const directorateList = directorates.data ?? [];
  const departmentList = departments.data?.data ?? [];

  return (
    <div className="space-y-6">
      {header}
      <CompaniesSection companies={companyList} />
      <DirectoratesSection companies={companyList} directorates={directorateList} />
      <DepartmentsSection
        companies={companyList}
        directorates={directorateList}
        departments={departmentList}
      />
      <TeamsSection departments={departmentList} teams={teams.data?.data ?? []} />
    </div>
  );
}
