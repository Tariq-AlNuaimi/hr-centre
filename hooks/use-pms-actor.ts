"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

/**
 * The signed-in user's PMS identity and capabilities — spec §4.4.
 *
 * PMS authority lives on the `Employee` record, not in the session (ADR-065), so
 * the chrome fetches it rather than reading it off the JWT. Kept fresh for a
 * minute: an HR role change should take effect on the next navigation, not at
 * token expiry.
 *
 * This gates AFFORDANCES only. Every route enforces the same rules server-side
 * — hiding a button is a courtesy to the user, never a control.
 */

export type PmsCapabilities = {
  orgWide: boolean;
  /** §4.1's HR — who may RUN the cycle, as opposed to who may SEE it. */
  hr: boolean;
  configure: boolean;
  viewCompensation: boolean;
  viewPersonal: boolean;
  viewIdDocuments: boolean;
  previewImport: boolean;
  applyImport: boolean;
  runCalibration: boolean;
  exportMasterResults: boolean;
  readOnly: boolean;
  lineManager: boolean;
};

export type PmsActorInfo = {
  employeeId: string | null;
  employeeName: string | null;
  entityId: string | null;
  departmentId: string | null;
  pmsRoles: string[];
  capabilities: PmsCapabilities;
};

const NO_CAPABILITIES: PmsCapabilities = {
  orgWide: false,
  hr: false,
  configure: false,
  viewCompensation: false,
  viewPersonal: false,
  viewIdDocuments: false,
  previewImport: false,
  applyImport: false,
  runCalibration: false,
  exportMasterResults: false,
  readOnly: false,
  lineManager: false,
};

export function usePmsActor() {
  const query = useQuery({
    queryKey: ["pms", "me"],
    queryFn: () => apiClient.get<PmsActorInfo>("/api/pms/me"),
    staleTime: 60_000,
  });

  return {
    actor: query.data ?? null,
    // Fail CLOSED while loading or on error: an unresolved actor shows the
    // smallest surface, never the largest. A flash of HR-only navigation for a
    // non-HR user would be a bug the server would then have to catch.
    capabilities: query.data?.capabilities ?? NO_CAPABILITIES,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
