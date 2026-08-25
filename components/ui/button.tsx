"use client";

import * as React from "react";
import { type VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/button-variants";
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

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

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
