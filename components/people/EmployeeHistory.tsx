import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDateTime } from "@/lib/format";
import type { HistoryEntry } from "@/lib/people/history";

/**
 * The record's History tab (UX review R10): what changed, who changed it and
 * when — field names only, never values (lib/people/history.ts).
 */
export function EmployeeHistory({ entries }: { entries: HistoryEntry[] }) {
  const t = useTranslations("people.history");
  const tFields = useTranslations("people.history.fields");
  const label = (field: string) =>
    tFields.has(field) ? tFields(field) : field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return (
    <SectionCard title={t("title")} subtitle={t("subtitle")}>
      {entries.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-col gap-0.5 border-b border-border pb-3 last:border-0"
            >
              <span className="text-sm text-foreground">
                {t.has(`action.${e.action}`) ? t(`action.${e.action}`) : e.action}
                {e.fields.length > 0 ? ` — ${e.fields.map(label).join(", ")}` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {e.actor ?? t("system")} · {formatDateTime(e.at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
