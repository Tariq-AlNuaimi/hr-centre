"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import type { AssignmentRow } from "./types";

/** A role's "Assigned to" list (UX review R12b): who holds it, for which scope. Bounded to 50. */
export function RoleHolders({ roleId }: { roleId: string }) {
  const t = useTranslations("rbac");
  const holders = useQuery({
    queryKey: ["rbac", "holders", roleId],
    queryFn: () =>
      apiClient.get<{ data: AssignmentRow[]; total: number }>(
        `/api/rbac/assignments?pageSize=50&roleId=${encodeURIComponent(roleId)}`,
      ),
  });
  if (holders.isLoading) return <div className="h-10 animate-pulse rounded-md bg-muted" />;
  if (holders.isError)
    return (
      <p role="alert" className="text-sm text-destructive-emphasis">
        {t("loadFailed")}
      </p>
    );
  const rows = holders.data?.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("noHolders")}</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {rows.map((a) => (
        <li key={a.id} className="flex flex-wrap gap-x-2">
          <span className="text-foreground">{a.user.name ?? a.user.email}</span>
          <span className="text-muted-foreground">
            {t(`scopeType.${a.scopeType}`)}
            {a.scopeLabel ? ` · ${a.scopeLabel}` : ""}
            {a.expired ? ` · ${t("expired")}` : ""}
          </span>
        </li>
      ))}
      {(holders.data?.total ?? 0) > rows.length ? (
        <li className="text-xs text-muted-foreground">
          {t("moreHolders", { count: (holders.data?.total ?? 0) - rows.length })}
        </li>
      ) : null}
    </ul>
  );
}
