"use client";

import { useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import type { MidYearNote } from "@/lib/pms/year-end-select";

/**
 * P2-3 — the context beside a rating (Culture Amp's questions-left,
 * context-right review form): what was agreed about this KPI at mid-year and the
 * evidence put against it, so the rater does not have to leave the form to
 * remember the year. The five level descriptors are the choices themselves, on
 * the left. Read-only: nothing here is an input.
 */
export function RatingContextPanel({
  midYearNote,
  evidenceCount,
  children,
}: {
  midYearNote: MidYearNote | null | undefined;
  evidenceCount: number;
  /** The evidence list itself, rendered by the caller (it owns the edit rules). */
  children?: React.ReactNode;
}) {
  const t = useTranslations("pms.ratingContext");
  return (
    <aside
      aria-label={t("label")}
      className="space-y-4 rounded-md border border-border bg-muted/30 p-3 text-sm"
    >
      <section className="space-y-1">
        <h4 className="text-xs font-medium text-muted-foreground">{t("midYear")}</h4>
        {midYearNote ? (
          <>
            <p>{midYearNote.rationale}</p>
            {midYearNote.decisionReason && (
              <p className="text-xs text-muted-foreground">
                {t("decision", { reason: midYearNote.decisionReason })}
              </p>
            )}
            {midYearNote.decidedAt && (
              <p className="text-xs text-muted-foreground">
                {t("approvedOn", { when: formatDate(midYearNote.decidedAt) })}
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">{t("noMidYear")}</p>
        )}
      </section>
      <section className="space-y-1">
        <h4 className="text-xs font-medium text-muted-foreground">
          {t("evidence", { count: evidenceCount })}
        </h4>
        {children}
      </section>
    </aside>
  );
}
