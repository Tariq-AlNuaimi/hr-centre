import type { ReactNode } from "react";
import { brand } from "@/brand.config";

/**
 * BrandedStatus (ADR-029, Workstream C2 — shadcn/Tailwind rebuild, same prop
 * API). One branded surface for every "status" screen — 404 / 403 / 500 /
 * maintenance. Centered brand mark + headline + supporting copy + actions,
 * on-token in both modes (semantic surface tokens + brand utilities). Reusing
 * one primitive keeps these pages consistent and rebrandable from brand.config
 * (the /design-system "build on the shared primitive" rule).
 */
export function BrandedStatus({
  code,
  title,
  subtitle,
  icon,
  actions,
  minHeight = "70vh",
}: {
  /** Large status code (e.g. "404"); omit for icon-led screens. */
  code?: string;
  title: string;
  subtitle?: string;
  /** Optional icon shown in the brand chip instead of the monogram. */
  icon?: ReactNode;
  actions?: ReactNode;
  minHeight?: string | number;
}) {
  return (
    <div
      className="flex items-center justify-center p-density-page"
      style={{ minHeight }}
    >
      <div className="max-w-[460px] text-center">
        <span
          aria-hidden
          className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-2xl font-bold leading-none text-primary-foreground shadow-md"
        >
          {icon ?? brand.monogram}
        </span>

        {code && (
          <div className="mb-1 text-[56px] font-extrabold leading-none tracking-tight text-foreground">
            {code}
          </div>
        )}

        <h3 className="mb-1 text-h4 font-semibold text-foreground">{title}</h3>

        {subtitle && (
          <p className="mb-6 text-sm text-muted-foreground">{subtitle}</p>
        )}

        {actions && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
