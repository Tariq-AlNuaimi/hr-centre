"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { MODULES, PERMISSIONS } from "@/lib/rbac/catalogue";
import type { RoleRow } from "./types";

/**
 * Roles × actions, read-only (UX review R12a): one row per action grouped by
 * module, one column per role. Editing stays in the role dialog; this answers
 * "which roles can do X?" at a glance.
 */
export function RoleMatrix({ roles }: { roles: RoleRow[] }) {
  const t = useTranslations("rbac");
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-max min-w-full border-collapse text-sm">
        <caption className="sr-only">{t("matrixCaption")}</caption>
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th
              scope="col"
              className="sticky start-0 z-10 bg-muted px-3 py-2 text-start font-medium"
            >
              {t("matrixAction")}
            </th>
            {roles.map((r) => (
              <th
                key={r.id}
                scope="col"
                className="max-w-32 px-2 py-2 text-center text-xs font-medium"
              >
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULES.map((module) => (
            <ModuleRows key={module} module={module} roles={roles} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleRows({ module, roles }: { module: (typeof MODULES)[number]; roles: RoleRow[] }) {
  const t = useTranslations("rbac");
  const actions = PERMISSIONS.filter((p) => p.module === module);
  return (
    <>
      <tr className="border-b border-border">
        <th
          scope="colgroup"
          colSpan={roles.length + 1}
          className="sticky start-0 bg-card px-3 pt-3 pb-1 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t(`module.${module}`)}
        </th>
      </tr>
      {actions.map((p) => (
        <tr key={p.code} className="border-b border-border last:border-0">
          <th scope="row" className="sticky start-0 bg-card px-3 py-1.5 text-start font-normal">
            {t(`permission.${p.code}`)}
          </th>
          {roles.map((r) =>
            r.permissions.includes(p.code) ? (
              <td key={r.id} className="px-2 py-1.5 text-center">
                <Check aria-label={t("matrixHas")} className="mx-auto h-4 w-4 text-primary" />
              </td>
            ) : (
              <td key={r.id} className="px-2 py-1.5 text-center text-muted-foreground">
                <span className="sr-only">{t("matrixHasNot")}</span>
              </td>
            ),
          )}
        </tr>
      ))}
    </>
  );
}
