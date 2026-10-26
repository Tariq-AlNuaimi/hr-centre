"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { scheduleStatus } from "@/lib/hiring/interview-rules";
import { cn } from "@/lib/utils";

/** Small shared pieces of the interview screens: round label, RSVP badge, vote badge, score dots. */

export function initials(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function useRoundLabel() {
  const ti = useTranslations("hiring.interviews");
  const tr = useTranslations("hiring.round");
  return (round: string, ordinal?: number | null) =>
    ordinal && ordinal > 0 ? ti("roundOrdinal", { n: ordinal, name: tr(round) }) : tr(round);
}

const RSVP_TONE = {
  CANCELLED: "danger",
  COMPLETED: "success",
  IN_PROGRESS: "warning",
  NO_PANEL: "default",
  CONFIRMED: "success",
  INVITES_SENT: "info",
} as const;

export function RsvpBadge({
  status,
  panel,
}: {
  status: string;
  panel: readonly { confirmedAt: string | Date | null }[];
}) {
  const t = useTranslations("hiring.interviews.rsvp");
  const s = scheduleStatus(status, panel);
  return (
    <Badge
      variant={RSVP_TONE[s.code]}
      title={t(`${s.code}.detail`, { confirmed: s.confirmed, total: s.total })}
    >
      {t(`${s.code}.label`)}
    </Badge>
  );
}

const VOTE_TONE = {
  STRONG_HIRE: "success",
  HIRE: "brand",
  NO_HIRE: "warning",
  STRONG_NO_HIRE: "danger",
} as const;

export function VoteBadge({ vote }: { vote: string | null | undefined }) {
  const t = useTranslations("hiring.vote");
  if (!vote) return null;
  return <Badge variant={VOTE_TONE[vote as keyof typeof VOTE_TONE] ?? "default"}>{t(vote)}</Badge>;
}

/** 1–5 as five squares; interactive when `onChange` is given (radio semantics). */
export function ScoreDots({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange?: (n: number) => void;
  label: string;
}) {
  const t = useTranslations("hiring.panel");
  return (
    <div
      role={onChange ? "radiogroup" : "img"}
      aria-label={onChange ? label : t("scoreOf", { label, score: value })}
      className="flex gap-1"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value;
        const cls = cn(
          "grid h-7 w-7 place-items-center rounded-md font-mono text-xs font-bold",
          on
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-muted text-muted-foreground",
        );
        return onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={t("scoreN", { n })}
            className={cls}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ) : (
          <span key={n} aria-hidden className={cls}>
            {n}
          </span>
        );
      })}
    </div>
  );
}
