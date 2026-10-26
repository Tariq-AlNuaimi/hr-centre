import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * A native select on the input tokens. Native on purpose: these pickers hold a
 * few dozen org units at most, and a native control is keyboard- and
 * screen-reader-correct for free.
 */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    />
  );
}
