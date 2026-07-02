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
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground",
        brand: "bg-primary/10 text-primary",
        success:
          "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
        warning:
          "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
        danger: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
        outline: "border border-input text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
