"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { apiClient } from "@/lib/api-client";

/**
 * What the current user may reach in HIVE's admin surface.
 *
 * Backed by `GET /api/hive/me/permissions` because §5.3's four booleans live on
 * `User` and deliberately never enter the session -- the Permission Editor
 * promises changes take effect immediately, and a claim copied into a JWT is a
 * snapshot. One cached request per session buys chrome that matches what the
 * server will actually allow.
 *
 * `staleTime` is short rather than long on purpose: this rides the shared
 * dashboard shell, so a long cache would leave a just-granted editor staring at
 * a menu that has not noticed yet -- the same staleness the service layer
 * refuses. A minute is short enough that "Alaa grants it, Muna reloads, it is
 * there" holds, and long enough that navigating between pages does not refetch.
 */

export interface HiveAccess {
  seeTickets: boolean;
  draftEscalation: boolean;
  approve: boolean;
  editContent: boolean;
  configure: boolean;
  viewReports: boolean;
  isAdmin: boolean;
  /** Display only (ADR-073, AC-T3.7). Never branch on it. */
  roleLabel: "Admin" | "Approver" | "Drafter" | "Viewer";
}

const NONE: HiveAccess = {
  seeTickets: false,
  draftEscalation: false,
  approve: false,
  editContent: false,
  configure: false,
  viewReports: false,
  isAdmin: false,
  roleLabel: "Viewer",
};

/** @public */
export function useHiveAccess(): HiveAccess {
  const { status } = useSession();

  const { data } = useQuery({
    queryKey: ["hive-access"],
    queryFn: ({ signal }) => apiClient.get<HiveAccess>("/api/hive/me/permissions", { signal }),
    // Signed-out chrome must not fire an authenticated request; the login page
    // renders outside this shell, but a session that expires mid-visit would
    // otherwise loop on 401s.
    enabled: status === "authenticated",
    staleTime: 60_000,
    // No `meta.errorMessage`: a failure here should quietly hide a menu entry,
    // not toast an error over whatever the user is actually doing.
    retry: false,
  });

  return data ?? NONE;
}
