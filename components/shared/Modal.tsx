"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ModalProps {
  /** Controlled open state. Omit both to use `trigger` as an uncontrolled opener. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional element that opens the modal (cloned as the Radix trigger). */
  trigger?: ReactNode;
  title?: ReactNode;
  /** Accessible description under the title (also wires aria-describedby). */
  description?: ReactNode;
  /** Body content. */
  children?: ReactNode;
  /** Inline-end action row (e.g. Cancel + Save buttons). */
  footer?: ReactNode;
  className?: string;
}

/**
 * Modal (ADR-029, Workstream C2) — the reusable overlay for the app, on the
 * Radix-backed Dialog primitive. Radix owns the focus trap, Escape / outside-
 * click close, scroll lock and aria wiring; this wrapper supplies the branded
 * header / body / footer layout on the semantic surface tokens. Replaces AntD
 * `Modal`. Use controlled (`open` + `onOpenChange`) for imperative flows, or
 * pass a `trigger` for the simple open-on-click case.
 */
export function Modal({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  className,
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className={cn(className)}>
        {(title || description) && (
          <DialogHeader>
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
