"use client";

import { Home } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useBreadcrumb } from "./BreadcrumbProvider";
import { localePrefixRegex } from "@/i18n/config";
import Link from "next/link";

/**
 * Path segments that group routes without being one.
 *
 * `/admin/import`, `/admin/org-setup`, `/admin/cycles` and `/admin/roles` all
 * exist; `/admin` does not. Every one of those pages therefore rendered a
 * clickable "Admin" crumb pointing at a 404 — and Next prefetched it on hover,
 * so the 404 fired on every render whether or not anyone clicked. Found while
 * screenshotting the Phase 2 screens; it predates them and affects the Phase 1
 * admin screens identically.
 */
const NON_NAVIGABLE_SEGMENTS = new Set(["admin"]);

const segmentToNavKey: Record<string, string> = {
  users: "users",
  "audit-log": "auditLog",
  settings: "settings",
  profile: "profile",
  "recycling-bin": "recyclingBin",
  new: "create",
};

// Fallback for a route segment with no nav-key mapping and no dynamic label (e.g. a
// scaffolded entity like `asset` or `custom-field-def`): show a humanized label
// ("Asset", "Custom Field Def") instead of the raw lowercase segment. kebab/snake → Title
// Case. This is a computed value, not literal JSX copy, so it is not a next-intl chokepoint
// bypass — dedicated segments should still get a real `nav` message key when one exists.
function humanizeSegment(seg: string): string {
  return seg.replace(/[-_]+/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const { dynamicLabels } = useBreadcrumb();
  const locale = useLocale();

  // Strip locale prefix: /en/users/123 -> ['users', '123']
  const segments = pathname.replace(localePrefixRegex, "").split("/").filter(Boolean);

  type Crumb = { key: string; node: React.ReactNode; isLast: boolean };

  const items: Crumb[] = [
    {
      key: "__home",
      node: (
        <Link
          href={`/${locale}`}
          className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t("home")}
        >
          <Home className="h-4 w-4" />
        </Link>
      ),
      isLast: segments.length === 0,
    },
    ...segments.map((segment, index) => {
      const path = `/${locale}/` + segments.slice(0, index + 1).join("/");
      const navKey = segmentToNavKey[segment];
      let label: string;

      if (dynamicLabels[segment]) {
        label = dynamicLabels[segment];
      } else if (navKey) {
        // Try nav translations first, fall back to common
        try {
          label = t(navKey);
        } catch {
          try {
            label = tCommon(navKey);
          } catch {
            label = humanizeSegment(segment);
          }
        }
      } else {
        label = humanizeSegment(segment);
      }

      const isLast = index === segments.length - 1;
      // A grouping segment has no page of its own, so linking it produces a
      // breadcrumb that 404s when clicked — and a prefetch that 404s on every
      // render even when nobody clicks it. Rendered as plain text instead: it
      // still shows where you are, it just does not promise a destination that
      // was never built.
      const navigable = !NON_NAVIGABLE_SEGMENTS.has(segment);

      return {
        key: `${segment}-${index}`,
        node:
          isLast || !navigable ? (
            <span className={isLast ? "text-foreground" : "text-muted-foreground"}>{label}</span>
          ) : (
            <Link
              href={path}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {label}
            </Link>
          ),
        isLast,
      };
    }),
  ];

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {items.map((item, index) => (
          <li key={item.key} className="inline-flex items-center gap-2">
            {index > 0 && (
              <span aria-hidden className="text-muted-foreground select-none">
                /
              </span>
            )}
            {item.isLast ? <span aria-current="page">{item.node}</span> : item.node}
          </li>
        ))}
      </ol>
    </nav>
  );
}
