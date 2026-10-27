"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Notice } from "./states";

/**
 * "Nobody holds this step" — shown in place of a working submit button
 * (docs/blueprints/ux-p0.md, AC-3.1). Names the steps, and tells a platform
 * admin where to fix it; everyone else is told who can.
 */
export function VacantStepsNotice({ roles }: { roles: string[] }) {
  const t = useTranslations("hiring.vacant");
  const tr = useTranslations("hiring.roles");
  const locale = useLocale();
  const { data: session } = useSession();
  if (roles.length === 0) return null;
  const names = [...new Set(roles)].map((r) => tr(r)).join(", ");
  return (
    <Notice tone="warning" title={t("title", { roles: names })}>
      {session?.user?.role === "ADMIN" ? (
        <>
          {t("bodyAdmin")}{" "}
          <Link
            href={`/${locale}/admin/roles`}
            className="font-medium underline underline-offset-4"
          >
            {t("openRoles")}
          </Link>
        </>
      ) : (
        t("body")
      )}
    </Notice>
  );
}

/** The roles of the steps no available person can decide. */
export function vacantRoles(
  steps: ReadonlyArray<{ role: string; approvers: ReadonlyArray<{ id: string }> }>,
  exclude: ReadonlyArray<string | null | undefined> = [],
): string[] {
  const out = new Set(exclude.filter(Boolean));
  return steps.filter((s) => !s.approvers.some((a) => !out.has(a.id))).map((s) => s.role);
}
