"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { Option } from "./ReferenceManager";

type Named = { id: string; name: string; entityId?: string; entity?: { code: string } };

/**
 * Choices for the optional company / directorate / department links on
 * coverage rows. Core org is read-only here (edited under Admin → Organisation).
 */
export function useOrgOptions(noneLabel: string) {
  const companies = useQuery({
    queryKey: ["hive-org", "entities"],
    queryFn: () => apiClient.get<Named[]>("/api/org/entities"),
  });
  const directorates = useQuery({
    queryKey: ["hive-org", "directorates"],
    queryFn: () => apiClient.get<Named[]>("/api/org/directorates"),
  });
  const departments = useQuery({
    queryKey: ["hive-org", "departments"],
    queryFn: async () =>
      (await apiClient.get<{ data: Named[] }>("/api/org/departments?pageSize=100")).data,
  });
  const none: Option = { value: "", label: noneLabel };
  const name = (list: Named[] | undefined, id: unknown) =>
    (list ?? []).find((x) => x.id === id)?.name ?? null;
  return {
    companyOptions: [none, ...(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))],
    directorateOptions: [
      none,
      ...(directorates.data ?? []).map((d) => ({
        value: d.id,
        label: d.entity ? `${d.entity.code} · ${d.name}` : d.name,
      })),
    ],
    departmentOptions: [
      none,
      ...(departments.data ?? []).map((d) => ({
        value: d.id,
        label: d.entity ? `${d.entity.code} · ${d.name}` : d.name,
      })),
    ],
    companyName: (id: unknown) => name(companies.data, id),
    unitName: (row: Record<string, unknown>) =>
      name(directorates.data, row.directorateId) ?? name(departments.data, row.departmentId),
  };
}
