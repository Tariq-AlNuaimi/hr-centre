"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * EmptyState (ADR-029, Workstream C2 — shadcn/Tailwind rebuild, same prop API).
 * The honest "no data" state: a muted glyph, a description, and an optional
 * primary action. On-token neutral palette with `dark:` pairs; RTL-safe
 * (centered, no physical spacing).
 */
export function EmptyState({ description, actionLabel, onAction }: EmptyStateProps) {
  const t = useTranslations("common");

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <svg
        aria-hidden
        viewBox="0 0 64 64"
        className="h-14 w-14 text-muted-foreground/40"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <rect x="10" y="18" width="44" height="32" rx="4" />
        <path d="M10 28h44" />
        <path d="M22 40h20" strokeLinecap="round" />
      </svg>
      <p className="text-sm text-muted-foreground">{description ?? t("noData")}</p>
      {actionLabel && onAction && <Button onClick={onAction}>{actionLabel}</Button>}
    </div>
  );
}
