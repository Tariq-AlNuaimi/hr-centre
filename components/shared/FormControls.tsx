"use client";

import type { ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Label + control + hint/error — the one field layout every form uses (Hiring,
 * Joiners & leavers, core screens; P2 platform, promoted from Hiring's kit).
 * `id` is an alias of `htmlFor` (the JML kit's prop name).
 */
export function Field({
  label,
  htmlFor,
  id,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  id?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor ?? id} className="text-sm font-medium text-foreground">
        {label}
        {required ? <span className="ms-0.5 text-destructive-emphasis">*</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive-emphasis">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    />
  );
}

/** A labelled checkbox (native — keyboard and screen-reader correct for free). */
export function Check({
  id,
  checked,
  onChange,
  children,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm text-foreground">
      <input
        id={id}
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
