"use client";

import { useTranslations } from "next-intl";
import { SectionCard } from "@/components/shared/SectionCard";
import { formatDateTime } from "@/lib/format";
import { StageBadge } from "../ui/stage";
import type { CandidateDetail } from "./types";

/** Stage history, newest first, with who moved them and why. */
export function TimelineTab({ c }: { c: CandidateDetail }) {
  const t = useTranslations("hiring.candidate");
  return (
    <SectionCard title={t("historyTitle")}>
      {c.history.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
      ) : (
        <ol className="space-y-4 border-s border-border ps-4">
          {c.history.map((h) => (
            <li key={h.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StageBadge stage={h.fromStage} />
                <span aria-hidden>→</span>
                <StageBadge stage={h.toStage} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("movedBy", {
                  name: h.movedBy?.name ?? t("system"),
                  date: formatDateTime(h.movedAt),
                })}
              </p>
              {h.reason ? <p className="text-xs italic text-muted-foreground">{h.reason}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
