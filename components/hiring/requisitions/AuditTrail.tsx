"use client";

import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDateTime } from "@/lib/format";
import { useHiringQuery } from "../ui/api";

type AuditRow = {
  id: string;
  action: string;
  changes: Record<string, unknown> | null;
  actorEmail: string | null;
  timestamp: string;
};

/** Every recorded change to the requisition (audit log; band values hidden from non-pay readers). */
export function AuditTrail({ id }: { id: string }) {
  const t = useTranslations("hiring.requisition");
  const { data } = useHiringQuery<{ audit: AuditRow[] }>(`/api/hiring/requisitions/${id}/history`);
  const rows = data?.audit ?? [];
  return (
    <SectionCard title={t("auditTitle")} subtitle={t("auditHint")}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("auditEmpty")}</p>
      ) : null}
      <ul className="space-y-2">
        {rows.map((a) => (
          <li key={a.id} className="text-sm">
            <span className="font-medium text-foreground">{a.action}</span>{" "}
            <span className="text-muted-foreground">
              {Object.keys(a.changes ?? {}).join(", ")} · {a.actorEmail ?? t("system")} ·{" "}
              {formatDateTime(a.timestamp)}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
