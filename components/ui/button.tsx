"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button — shadcn/ui-style primitive (ADR-029, Workstream C2). Radix-free base
 * (a plain <button>) so it carries no extra dep; variants via cva. On-token:
 * brand utilities (`bg-primary`) + Tailwind's neutral palette with `dark:`
 * pairs, logical focus ring, RTL-safe (no physical margins). The low-level
 * button the rebuilt shared primitives and screens build on, replacing AntD
 * `<Button>` incrementally during the coexistence slice.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-white hover:opacity-90",
        secondary:
          "bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-50 dark:hover:bg-gray-700",
        outline:
          "border border-gray-300 bg-transparent text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-50 dark:hover:bg-gray-800",
        ghost:
          "bg-transparent text-gray-900 hover:bg-gray-100 dark:text-gray-50 dark:hover:bg-gray-800",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        link: "bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-9 px-4",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
