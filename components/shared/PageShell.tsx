import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageShellProps {
  children: ReactNode;
  /**
   * Content max-width. "wide" (default) for lists/dashboards, "narrow" for
   * forms/settings/reading surfaces, "full" to opt out.
   */
  width?: "wide" | "narrow" | "full";
  className?: string;
}

const WIDTHS: Record<NonNullable<PageShellProps["width"]>, string> = {
  wide: "max-w-screen-2xl",
  narrow: "max-w-2xl",
  full: "max-w-none",
};

/**
 * PageShell (V2-302 layout primitive). The one page-content frame: centers content
 * to a max-width and owns the **vertical rhythm** between page sections (`space-y-6`,
 * on the token scale) so pages don't hand-roll margins. Horizontal padding is the
 * `(dashboard)` layout's job — this only constrains width + spaces sections. Logical
 * spacing mirrors correctly under RTL; no color of its own (inherits the surface).
 *
 * Compose: `<PageShell><PageHeader …/> <Toolbar …/> <DataTable …/></PageShell>`.
 */
export function PageShell({ children, width = "wide", className }: PageShellProps) {
  return <div className={cn("mx-auto w-full space-y-6", WIDTHS[width], className)}>{children}</div>;
}
