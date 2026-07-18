import * as React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { AiMark } from "./AiMark";

/**
 * AiStreaming — the HONEST "AI is generating" state (MIGRATION.md). A labelled
 * shimmer of skeleton lines while a completion streams; when `text` is provided
 * it renders that instead, with a blinking caret while `done` is false. This is
 * the loading half of the state triad — never a fake success. Label localized by
 * the caller (`label` prop).
 */
export function AiStreaming({
  label = "Generating…",
  lines = 2,
  text,
  done = false,
  className,
}: {
  label?: string;
  /** Skeleton line count shown when no `text` is streaming yet. */
  lines?: number;
  /** The streamed text so far; when set, replaces the skeleton. */
  text?: string;
  /** When true, hides the caret (stream complete). */
  done?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <div className="mb-3 flex items-center gap-2">
        <AiMark size={22} />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span aria-hidden className="ms-auto inline-flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
      </div>
      {text === undefined ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {Array.from({ length: lines }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-2.5"
              style={{ width: i === lines - 1 ? "78%" : "100%" }}
            />
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm leading-relaxed text-foreground" aria-live="polite">
          {text}
          {!done ? (
            <span
              aria-hidden
              className="ms-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-text-bottom"
            />
          ) : null}
        </p>
      )}
    </div>
  );
}
