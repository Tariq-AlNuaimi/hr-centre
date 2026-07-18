import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * AiMark — the shared royal ✦ glyph that tags every AI-augmented surface
 * (MIGRATION.md "AI pattern primitives"). One mark, one accent: brand-soft fill
 * + brand-as-text emphasis, on-token so dark mode is the single variable swap.
 * Decorative by default (aria-hidden); pass an `aria-label` to name it.
 */
const MARK = "✦"; // ✦ — rendered via expression so it isn't a literal JSX text node

export function AiMark({
  className,
  size = 24,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { size?: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-md bg-primary/10 text-primary-emphasis",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.58) }}
      {...props}
    >
      {MARK}
    </span>
  );
}
