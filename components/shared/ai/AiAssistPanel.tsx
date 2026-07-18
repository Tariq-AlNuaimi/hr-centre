import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AiMark } from "./AiMark";
import { ConfidenceChip } from "./ConfidenceChip";

/**
 * AiAssistPanel — the canonical Rihal AI advisory frame (MIGRATION.md): a finding
 * the AI surfaces for a human to decide, never acts on. Left royal accent + ✦
 * mark signal "AI"; an optional risk badge and confidence chip qualify it; the
 * body + citations ground it; and an `actions` slot carries the human decision
 * (Accept / Reject / Edit). Advisory by construction — it renders no autonomous
 * action itself. All copy comes from props/children (caller localizes).
 */
const RISK_VARIANT = {
  low: "success",
  medium: "warning",
  high: "danger",
} as const;

export function AiAssistPanel({
  title,
  risk,
  riskLabel,
  confidence,
  confidenceLabel,
  meta,
  children,
  actions,
  className,
}: {
  title: React.ReactNode;
  /** Risk level → a token-toned badge; omit for no badge. */
  risk?: "low" | "medium" | "high";
  /** Visible risk text (localized), e.g. "Medium risk". */
  riskLabel?: string;
  /** 0–1 model confidence; renders a ConfidenceChip when set. */
  confidence?: number;
  /** aria-label for the confidence chip (localized). */
  confidenceLabel?: string;
  /** Trailing meta, e.g. a clause/section ref. */
  meta?: React.ReactNode;
  children: React.ReactNode;
  /** Human decision controls (Accept / Reject / Edit …). */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-l-2 border-border border-l-primary bg-card p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <AiMark size={22} />
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {risk ? <Badge variant={RISK_VARIANT[risk]}>{riskLabel ?? risk}</Badge> : null}
        {confidence !== undefined ? (
          <ConfidenceChip value={confidence} label={confidenceLabel} />
        ) : null}
        {meta ? (
          <span className="ms-auto font-mono text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      <div className="mt-2 text-sm leading-relaxed text-foreground">{children}</div>
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
