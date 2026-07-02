"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

/**
 * Popover — shadcn/ui-style popover on @radix-ui/react-popover (ADR-029,
 * Workstream C2). Radix owns focus management, outside-click / Escape close,
 * and collision-aware positioning (so it flips instead of clipping); we style
 * the panel on the semantic surface tokens. Used by DataView's column-visibility
 * control and DataTable's per-column filter menu, replacing AntD `Popover`.
 */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "end", sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-44 rounded-md border border-border bg-card p-2 text-card-foreground shadow-lg outline-none",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;
