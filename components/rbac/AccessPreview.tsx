"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { apiClient } from "@/lib/api-client";
import { MODULES, PERMISSIONS } from "@/lib/rbac/catalogue";
import { UserSearch } from "./UserSearch";
import type { EffectiveAccess } from "./types";

type Account = { id: string; name: string | null; email: string };

/**
 * "View access as…" (UX review R12d): pick a person and see what they can do
 * right now, module by module, and where — from the same active assignments the
 * server checks. Read-only.
 */
export function AccessPreview() {
  const t = useTranslations("rbac");
  const [account, setAccount] = useState<Account | null>(null);
  const access = useQuery({
    queryKey: ["rbac", "effective", account?.id],
    queryFn: () =>
      apiClient.get<EffectiveAccess>(
        `/api/rbac/effective?userId=${encodeURIComponent(account?.id ?? "")}`,
      ),
    enabled: Boolean(account?.id),
  });
  const held = new Map((access.data?.permissions ?? []).map((p) => [p.code, p.scopes]));
  const scopeText = (scopes: Array<{ type: string; label: string | null }>) =>
    scopes.map((s) => `${t(`scopeType.${s.type}`)}${s.label ? ` · ${s.label}` : ""}`).join("; ");

  return (
    <SectionCard title={t("viewAsTitle")} subtitle={t("viewAsNote")}>
      <div className="max-w-md">
        <UserSearch
          id="view-as-user"
          label={t("viewAsTitle")}
          value={account}
          onChange={setAccount}
        />
      </div>
      {!account ? null : access.isLoading ? (
        <div className="mt-4 h-24 animate-pulse rounded-md bg-muted" />
      ) : access.isError ? (
        <p role="alert" className="mt-4 text-sm text-destructive-emphasis">
          {t("loadFailed")}
        </p>
      ) : held.size === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("viewAsNothing")}</p>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="m-0 text-sm text-muted-foreground">
            {t("viewAsRoles")}:{" "}
            {(access.data?.assignments ?? [])
              .map((a) => `${a.role.name} (${scopeText([a.scope])})`)
              .join(", ")}
          </p>
          {MODULES.map((module) => {
            const rows = PERMISSIONS.filter((p) => p.module === module && held.has(p.code));
            if (rows.length === 0) return null;
            return (
              <div key={module}>
                <h4 className="m-0 mb-1 text-sm font-semibold text-foreground">
                  {t(`module.${module}`)}
                </h4>
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm">
                  {rows.map((p) => (
                    <li key={p.code}>
                      <span className="text-foreground">{t(`permission.${p.code}`)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        — {scopeText(held.get(p.code)!)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
