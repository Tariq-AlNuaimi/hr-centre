import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Signal variants use the calm 3-tone scale (UI-SPEC A.2), never traffic-light
// red/green — pass/partial/below for band results.
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        accent: "border-transparent bg-accent/10 text-accent",
        // Base hue tints the fill; the darker -ink shade carries the text so small
        // badge labels clear WCAG AA 4.5:1 (UI-SPEC A.7) in both themes.
        pass: "border-transparent bg-[var(--signal-pass)]/12 text-[var(--signal-pass-ink)]",
        partial:
          "border-transparent bg-[var(--signal-partial)]/12 text-[var(--signal-partial-ink)]",
        below:
          "border-transparent bg-[var(--signal-below)]/12 text-[var(--signal-below-ink)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
