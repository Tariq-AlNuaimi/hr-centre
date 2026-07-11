import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Label — shadcn/ui-style form label (ADR-029, Workstream C2). A plain
 * `<label>` (no Radix dep) on the semantic `text-foreground` token; FormField
 * wires its `htmlFor` to the field id so clicking the label focuses the control.
 */
export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  // eslint-disable-next-line jsx-a11y/label-has-associated-control -- reusable primitive; the association is made at the call site (FormField supplies htmlFor), which this rule cannot see from the primitive definition
  <label
    ref={ref}
    className={cn("text-sm font-medium text-foreground peer-disabled:opacity-70", className)}
    {...props}
  />
));
Label.displayName = "Label";
