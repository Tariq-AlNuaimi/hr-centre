import type { ReactNode } from "react";

interface PageHeaderProps {
  /** The page heading. Renders as an <h{level}> for correct heading order. */
  title: ReactNode;
  /** Optional muted line under the title (one sentence — what this screen is for). */
  subtitle?: ReactNode;
  /** Inline-end slot — the screen's ONE primary action (+ at most one secondary).
   *  RTL-mirrors automatically (flex respects `dir`). */
  actions?: ReactNode;
  /** Heading level. Default 2 (a page's top heading; the app name is the h1). */
  level?: 1 | 2 | 3 | 4 | 5;
}

/** Heading size per level, off the type scale in tokens.css. */
const HEADING_SIZE: Record<number, string> = {
  1: "text-h1",
  2: "text-h3",
  3: "text-h4",
  4: "text-h5",
  5: "text-lg",
};

/**
 * PageHeader (ADR-029, Workstream C2 — shadcn/Tailwind rebuild, same prop API).
 * The one page-title pattern for the whole app: heading + optional subtitle on
 * the inline-start, the primary action on the inline-end, consistent on-token
 * spacing below. Renders a real <h{level}> for heading order; on-token type +
 * semantic colors, logical spacing so it mirrors correctly under RTL.
 *
 * One primary action per header (Tier-0 anti-slop rule): pass a single primary
 * button in `actions`; additional buttons stay secondary/ghost.
 */
export function PageHeader({ title, subtitle, actions, level = 2 }: PageHeaderProps) {
  const Heading = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5";
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <Heading
          className={`m-0 font-semibold tracking-tight text-foreground ${HEADING_SIZE[level]}`}
        >
          {title}
        </Heading>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
