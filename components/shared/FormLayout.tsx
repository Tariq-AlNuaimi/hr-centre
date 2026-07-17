import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FormLayoutProps {
  children: ReactNode;
  /**
   * The footer action row — the form's ONE primary submit (+ at most a Cancel).
   * Rendered inline-end-aligned with a divider above; RTL-mirrors automatically.
   */
  actions?: ReactNode;
  className?: string;
}

/**
 * FormLayout (V2-302 layout primitive). Owns a form's **vertical field rhythm**
 * (`space-y-4` between fields, on the token scale) and a consistent **footer action
 * row** (one primary button, per the anti-slop rule). Wrap the fields; pass the submit/
 * cancel buttons as `actions`. No surface of its own — sits inside a `SectionCard` or a
 * `narrow` `PageShell`. Logical spacing + `justify-end` mirror correctly under RTL.
 *
 * Compose: `<FormLayout actions={<><Button…>Save</Button><Button variant="outline">Cancel</Button></>}>
 *   <FormField …/> …
 * </FormLayout>`.
 */
export function FormLayout({ children, actions, className }: FormLayoutProps) {
  return (
    <div className={cn("space-y-6", className)}>
      <div className="space-y-4">{children}</div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
