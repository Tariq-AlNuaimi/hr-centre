"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

/**
 * Switch — shadcn/ui-style toggle on @radix-ui/react-switch (ADR-029,
 * Workstream C3). Radix owns the `role="switch"` semantics, keyboard toggle,
 * and `aria-checked` state; styled on the semantic surface tokens (brand fill
 * when on, muted track when off) so dark mode is the single variable swap. The
 * knob uses logical translate offsets so it slides correctly under RTL.
 * Replaces AntD `<Switch>`.
 */
export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-sm ring-0 transition-transform ltr:data-[state=checked]:translate-x-5 ltr:data-[state=unchecked]:translate-x-0 rtl:data-[state=checked]:-translate-x-5 rtl:data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;
