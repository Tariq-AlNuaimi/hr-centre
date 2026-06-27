"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Columns3 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DecisionOutcomeValue } from "@/lib/validations/result";

export type CandidateRowView = {
  assessmentId: string;
  resultId: string | null;
  candidateEmail: string;
  candidateName: string | null;
  roleTitle: string;
  roleFamily: string;
  roleProfileId: string;
  status: string;
  statusLabel: string;
  completedAt: string | null;
  fitScore: number | null;
  decision: DecisionOutcomeValue | null;
  decisionLabel: string | null;
};

const DECISION_VARIANT: Record<DecisionOutcomeValue, "pass" | "partial" | "below"> = {
  ADVANCE: "pass",
  HOLD: "partial",
  DECLINE: "below",
};

// Fit thresholds for the mini-bar tint — calm 3-tone signal, never traffic-light.
function fitVariant(fit: number): "pass" | "partial" | "below" {
  if (fit >= 70) return "pass";
  if (fit >= 50) return "partial";
  return "below";
}

const FIT_FILL: Record<"pass" | "partial" | "below", string> = {
  pass: "bg-[var(--signal-pass)]",
  partial: "bg-[var(--signal-partial)]",
  below: "bg-[var(--signal-below)]",
};

// Rows + bulk-select for the candidates list (UI-SPEC D.6). Only rows with a
// resultId are selectable (you can only compare computed results). The compare
// action bar is a fixed island so the surrounding table stays a server read.
export function CandidatesTableBody({ rows }: { rows: CandidateRowView[] }) {
  const t = useTranslations("candidates");
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  function toggle(resultId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });
  }

  function compare() {
    const ids = [...selected];
    if (ids.length < 2) return;
    router.push(`/app/compare?ids=${ids.join(",")}`);
  }

  const count = selected.size;

  return (
    <>
      {rows.map((row) => {
        const selectable = row.resultId !== null;
        const isSelected = selectable && selected.has(row.resultId!);
        const displayName = row.candidateName ?? row.candidateEmail;
        return (
          <TableRow key={row.assessmentId} data-state={isSelected ? "selected" : undefined}>
            <TableCell>
              <input
                type="checkbox"
                className="size-4 cursor-pointer rounded border-input text-accent accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                checked={isSelected}
                disabled={!selectable}
                onChange={() => selectable && toggle(row.resultId!)}
                aria-label={t("selectRow", { name: displayName })}
              />
            </TableCell>
            <TableCell>
              <Link
                href={`/app/candidates/${row.assessmentId}`}
                className="flex flex-col underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
              >
                <span className="font-medium text-foreground">{displayName}</span>
                {row.candidateName && (
                  <span className="text-xs text-muted-foreground">{row.candidateEmail}</span>
                )}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">
              <span className="text-foreground">{row.roleTitle}</span>
              <span className="block text-xs">{row.roleFamily}</span>
            </TableCell>
            <TableCell className="text-end">
              {row.fitScore === null ? (
                <span className="text-muted-foreground">{t("noName")}</span>
              ) : (
                <div className="flex items-center justify-end gap-2">
                  <span
                    className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary"
                    aria-hidden
                  >
                    <span
                      className={`block h-full rounded-full ${FIT_FILL[fitVariant(row.fitScore)]}`}
                      style={{ width: `${row.fitScore}%` }}
                    />
                  </span>
                  <span className="w-7 text-end tabular-nums font-medium text-foreground">
                    {row.fitScore}
                  </span>
                </div>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">{row.statusLabel}</TableCell>
            <TableCell className="text-muted-foreground">
              {row.completedAt ?? t("notCompleted")}
            </TableCell>
            <TableCell>
              {row.decision ? (
                <Badge variant={DECISION_VARIANT[row.decision]}>{row.decisionLabel}</Badge>
              ) : (
                <span className="text-sm text-muted-foreground">{t("decision.none")}</span>
              )}
            </TableCell>
          </TableRow>
        );
      })}

      {count > 0 && (
        <CompareBar count={count} canCompare={count >= 2} onCompare={compare} />
      )}
    </>
  );
}

// Rendered via portal-free fixed positioning so it can live in the JSX returned by
// a <tbody> client island without producing invalid table markup.
function CompareBar({
  count,
  canCompare,
  onCompare,
}: {
  count: number;
  canCompare: boolean;
  onCompare: () => void;
}) {
  const t = useTranslations("candidates");
  return (
    <tr aria-hidden className="contents">
      <td className="contents">
        <div
          role="region"
          aria-label={t("compareSelected")}
          className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit items-center gap-4 rounded-xl border border-border bg-card px-4 py-2.5 shadow-raised"
        >
          <span className="text-sm tabular-nums text-foreground">
            {t("selected", { count })}
          </span>
          <Button size="sm" onClick={onCompare} disabled={!canCompare} title={t("compareHint")}>
            <Columns3 className="size-4" />
            {t("compareSelected")}
          </Button>
        </div>
      </td>
    </tr>
  );
}
