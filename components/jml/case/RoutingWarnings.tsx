"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LIVE, type CaseDetail } from "./types";

/** Task routing (US-5): routed tasks the HR owner is holding because the route is empty. */
export function RoutingWarnings({ detail }: { detail: CaseDetail }) {
  const t = useTranslations("jml.case.routing");
  const warnings = detail.routingWarnings ?? [];
  if (warnings.length === 0 || !LIVE.has(detail.status)) return null;
  return (
    <div role="status" className="rounded-md bg-status-warn p-3 text-sm text-status-warn-fg">
      <p className="m-0 font-medium">{t("title")}</p>
      <ul className="m-0 mt-1 list-disc ps-5">
        {warnings.map((w) => (
          <li key={w}>{t(w)}</li>
        ))}
      </ul>
      {warnings.some((w) => w !== "NO_LINE_MANAGER") ? (
        <Link href="/jml/settings/task-routing" className="mt-1 inline-block underline">
          {t("fix")}
        </Link>
      ) : null}
    </div>
  );
}
