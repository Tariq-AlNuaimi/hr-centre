import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Separator — a plain hairline divider (ADR-029, Workstream C3.5). No new dep:
 * a semantic `role="separator"` <div> on the `bg-border` token so dark mode is
 * the single [data-theme="dark"] variable swap. Replaces AntD `<Divider>`; the
 * horizontal form is the common case, vertical for inline groups. `decorative`
 * (the default for purely-visual rules) drops it from the a11y tree.
 */

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}

export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      role={decorative ? "none" : "separator"}
      aria-orientation={
        decorative ? undefined : orientation === "vertical" ? "vertical" : "horizontal"
      }
      className={cn(
        "shrink-0 bg-border",
        orientation === "vertical" ? "h-full w-px" : "h-px w-full",
        className,
      )}
      {...props}
    />
  ),
);
Separator.displayName = "Separator";
