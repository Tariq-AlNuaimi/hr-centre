"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { ROLE_TRACKS } from "@/lib/validations/employee";
import { FilterBar, FilterSelect } from "@/components/shared/FilterBar";
import { EmployeePicker } from "@/components/pms/EmployeePicker";
import { Button } from "@/components/ui/button";

export type DirectoryFilterValues = {
  entityId: string;
  directorateId: string;
  departmentId: string;
  teamId: string;
  managerId: string;
  managerName: string;
  roleTrack: string;
};

type Option = { id: string; name: string };

/**
 * The directory's org and reporting-line filters (UX review R11). Options come
 * from the org lookups every signed-in user may read; the rows they filter
 * are still scoped server-side to whom the viewer may see. Narrower levels
 * follow the wider ones (a team list for the chosen department).
 */
export function DirectoryFilters({
  value,
  onChange,
}: {
  value: DirectoryFilterValues;
  onChange: (next: Partial<DirectoryFilterValues>) => void;
}) {
  const t = useTranslations("pms.directory.filters");
  const tPms = useTranslations("pms");
  const entities = useQuery({
    queryKey: ["org", "entities"],
    queryFn: () => apiClient.get<Array<Option & { code: string }>>("/api/org/entities"),
    staleTime: 300_000,
  });
  const directorates = useQuery({
    queryKey: ["org", "directorates"],
    queryFn: () => apiClient.get<Array<Option & { entityId: string }>>("/api/org/directorates"),
    staleTime: 300_000,
  });
  const departments = useQuery({
    queryKey: ["org", "departments", "directory", value.entityId],
    queryFn: () =>
      apiClient.get<{ data: Array<Option & { directorateId?: string | null }> }>(
        `/api/org/departments?pageSize=200${value.entityId ? `&entityId=${encodeURIComponent(value.entityId)}` : ""}`,
      ),
    staleTime: 300_000,
  });
  const teams = useQuery({
    queryKey: ["org", "teams", "options", value.departmentId],
    queryFn: () =>
      apiClient.get<{ data: Option[] }>(
        `/api/org/teams?pageSize=100&departmentId=${encodeURIComponent(value.departmentId)}`,
      ),
    enabled: value.departmentId !== "",
    staleTime: 300_000,
  });

  const directorateOptions = (directorates.data ?? []).filter(
    (d) => !value.entityId || d.entityId === value.entityId,
  );
  const departmentOptions = (departments.data?.data ?? []).filter(
    (d) => !value.directorateId || d.directorateId === value.directorateId,
  );

  return (
    <FilterBar>
      <FilterSelect
        id="filter-company"
        label={t("company")}
        allLabel={t("all")}
        value={value.entityId}
        options={(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))}
        onChange={(entityId) =>
          onChange({ entityId, directorateId: "", departmentId: "", teamId: "" })
        }
      />
      {directorateOptions.length > 0 ? (
        <FilterSelect
          id="filter-directorate"
          label={t("directorate")}
          allLabel={t("all")}
          value={value.directorateId}
          options={directorateOptions.map((d) => ({ value: d.id, label: d.name }))}
          onChange={(directorateId) => onChange({ directorateId, departmentId: "", teamId: "" })}
        />
      ) : null}
      <FilterSelect
        id="filter-department"
        label={t("department")}
        allLabel={t("all")}
        value={value.departmentId}
        options={departmentOptions.map((d) => ({ value: d.id, label: d.name }))}
        onChange={(departmentId) => onChange({ departmentId, teamId: "" })}
      />
      <FilterSelect
        id="filter-team"
        label={t("team")}
        allLabel={t("all")}
        value={value.teamId}
        disabled={value.departmentId === ""}
        options={(teams.data?.data ?? []).map((tm) => ({ value: tm.id, label: tm.name }))}
        onChange={(teamId) => onChange({ teamId })}
      />
      <FilterSelect
        id="filter-track"
        label={t("roleTrack")}
        allLabel={t("all")}
        value={value.roleTrack}
        options={ROLE_TRACKS.map((r) => ({ value: r, label: tPms(`track.${r}`) }))}
        onChange={(roleTrack) => onChange({ roleTrack })}
      />
      {value.managerId ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("manager")}</span>
          <Button
            variant="outline"
            className="h-9"
            onClick={() => onChange({ managerId: "", managerName: "" })}
            aria-label={t("clearManager", { name: value.managerName })}
          >
            {value.managerName}
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="w-56">
          <EmployeePicker
            id="filter-manager"
            label={t("manager")}
            onPick={(p) => onChange({ managerId: p.id, managerName: p.name })}
          />
        </div>
      )}
    </FilterBar>
  );
}
