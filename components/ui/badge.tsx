import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge — shadcn/ui-style status/label pill (ADR-029, Workstream C2). Doubles
 * as the app's Tag primitive (AntD `<Tag>` replacement): small inline label
 * with semantic tones. Neutral tones (default/outline) ride the semantic
 * surface layer (`bg-muted`, `text-muted-foreground`, `border-input`) so dark
 * mode is the single variable swap; the status tones (success/warning/danger)
 * keep their own palette pair. No physical spacing — RTL safe by construction.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-status-neutral text-status-neutral-fg",
        brand: "bg-accent-subtle text-primary-emphasis",
        success: "bg-status-ok text-status-ok-fg",
        warning: "bg-status-warn text-status-warn-fg",
        danger: "bg-status-err text-status-err-fg",
        info: "bg-status-info text-status-info-fg",
        outline: "border border-input text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
