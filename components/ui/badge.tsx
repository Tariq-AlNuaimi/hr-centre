import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge — shadcn/ui-style status/label pill (ADR-029, Workstream C2). Doubles
 * as the app's Tag primitive (AntD `<Tag>` replacement): small inline label
 * with semantic tones. On-token neutral palette + `dark:` pairs; brand tone
 * uses the `bg-primary`/`text-primary` utilities. No physical spacing — RTL
 * safe by construction.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default:
          "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
        brand: "bg-primary/10 text-primary",
        success:
          "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
        warning:
          "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
        danger: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
        outline:
          "border border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300",
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
