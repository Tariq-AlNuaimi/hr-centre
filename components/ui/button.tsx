"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button — shadcn/ui-style primitive (ADR-029, Workstream C2). Radix-free base
 * (a plain <button>) so it carries no extra dep; variants via cva. On-token:
 * the semantic surface utilities (`bg-primary`, `bg-muted`, `text-foreground`,
 * `border-input`, `bg-destructive`) so dark mode follows the single
 * [data-theme="dark"] variable swap — no per-class `dark:` pairs. Logical focus
 * ring, RTL-safe (no physical margins). The low-level button the rebuilt shared
 * primitives and screens build on, replacing AntD `<Button>` incrementally.
 */
const buttonVariants = cva(
  // `appearance-none` resets the native <button> UA chrome (outset border /
  // system appearance). Tailwind Preflight is intentionally OFF during the
  // AntD coexistence slice (C1), so its global border/appearance reset isn't
  // applied — every native-element components/ui/* primitive must compensate
  // locally until C4 enables Preflight. (senior-review 2026-07-02)
  "appearance-none inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        secondary: "bg-muted text-foreground hover:bg-muted/70",
        outline:
          "border border-input bg-transparent text-foreground hover:bg-muted",
        ghost: "bg-transparent text-foreground hover:bg-muted",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
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
