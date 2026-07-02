import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input — shadcn/ui-style text input (ADR-029, Workstream C2). On-token: the
 * semantic `border-input` / `bg-background` / `text-foreground` surface with a
 * brand `ring-ring` focus-visible ring, so dark mode follows the single
 * variable swap. `aria-invalid` (set by FormField on a zod error) paints the
 * destructive border. Replaces AntD `<Input>` in the rebuilt form field.
 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type ?? "text"}
    className={cn(
      "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
