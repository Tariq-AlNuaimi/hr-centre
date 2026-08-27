"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

/**
 * "Platform administrators: Layla, Ahmed" — ADR-070, amended 2026-08-27.
 *
 * The half-answer this replaces: an HR Super Admin who is not also a platform
 * admin could see that platform administration exists and read the sentence
 * explaining who governs it, but could not find out WHO. So the screen told them
 * to go and ask, without saying whom to ask.
 *
 * Read-only by design, for both audiences. HR cannot grant platform
 * administration and this does not let them — it is a sentence, not a control.
 * ADR-065's boundary is unmoved; what changes is that the boundary is now
 * navigable instead of just declared.
 *
 * The empty case is the one worth writing carefully. "Nobody is a platform
 * administrator" is not a tidy zero state — it means the recycling bin, the audit
 * log and account creation are unreachable by anyone, and the only remedy is
 * outside the app. It says so.
 */

type PlatformAdmin = { name: string | null; email: string };
/**
 * `truncated` is true when there are more administrators than the route will
 * name. That is not a paging state to page through — it is a different answer,
 * and the UI gives a different sentence for it.
 */
type Roster = { admins: PlatformAdmin[]; truncated: boolean };

export function PlatformAdminRoster() {
  const t = useTranslations("access");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["access", "platform-admins"],
    queryFn: () => apiClient.get<Roster>("/api/users/platform-admins"),
    // A grant is a deliberate, rare act, and this is a sentence rather than a
    // control — a minute-old answer is never the reason someone is confused.
    staleTime: 60_000,
  });

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">{t("platformAdminsLoading")}</p>;
  }

  // A failure is stated, never rendered as an empty roster: "nobody is an
  // administrator" and "I could not find out" are different facts, and only one
  // of them should send someone to IT.
  if (isError) {
    return (
      <p role="alert" className="text-xs text-destructive-emphasis">
        {t("platformAdminsFailed")}
      </p>
    );
  }

  const admins = data?.admins ?? [];

  if (data?.truncated) {
    // Naming 25 of 40 would read as the complete list. Say the real thing
    // instead: the roster is not the useful answer any more.
    return (
      <p role="alert" className="text-xs text-destructive-emphasis">
        {t("platformAdminsTooMany")}
      </p>
    );
  }

  if (admins.length === 0) {
    return (
      <p role="alert" className="text-xs text-destructive-emphasis">
        {t("platformAdminsNone")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("platformAdminsLabel")}: </span>
        {admins.map((a) => a.name ?? a.email).join(", ")}
      </p>
      <p className="text-xs text-muted-foreground">{t("platformAdminsHint")}</p>
    </div>
  );
}
