import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * CitationLink — a grounded reference an AI answer cites (source doc, clause,
 * policy §). Small, brand-as-text, with a leading link glyph so a citation reads
 * distinctly from body copy. Copy comes from `children` (caller localizes it).
 */
const LINK_GLYPH = "↗";

export function CitationLink({
  href,
  children,
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary-emphasis underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <span aria-hidden className="font-mono">
        {LINK_GLYPH}
      </span>
      {children}
    </a>
  );
}
