"use client";

import { useHiringQuery } from "./api";

export type OrgOptions = {
  entities: { id: string; code: string; name: string }[];
  departments: { id: string; name: string; entityId: string; directorateId: string | null }[];
  manageableEntityIds: string[];
};

/** Companies + departments for the hiring forms (one cached query). */
export function useOrgOptions() {
  const q = useHiringQuery<OrgOptions>("/api/hiring/org-options");
  const departmentsOf = (entityId: string) =>
    (q.data?.departments ?? []).filter((d) => d.entityId === entityId);
  return { ...q, departmentsOf };
}
