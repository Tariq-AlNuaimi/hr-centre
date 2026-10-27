"use client";

import { Home } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useBreadcrumb } from "./BreadcrumbProvider";
import { locales } from "@/i18n/config";
import Link from "next/link";
import { normalisePath } from "@/lib/nav/resolve";
import { navTrail } from "@/lib/nav/trail";
import { useLocaleHref, useNavContext, useNavLabel } from "./use-nav-context";

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
const NON_NAVIGABLE_SEGMENTS = new Set(["admin", "participants"]);

/**
 * An opaque record id sitting in the MIDDLE of a path.
 *
 * `/goal-setting/<cycleId>/participants/<participantId>` has a page; the cycle
 * id on its own does not, and neither does `/participants`. Linking them
 * produced the same 404-on-prefetch as the `admin` crumb above. A trailing id
 * (`/people/<id>`) is a different case — it IS a page, and it is the last
 * segment, so it renders as text either way.
 *
 * Heuristic rather than a route manifest, and worth naming as one: a crumb that
 * is a cuid tells the reader nothing anyway, so the cost of being wrong here is
 * an unlinked crumb rather than a broken one.
 */
const OPAQUE_ID = /^c[a-z0-9]{20,}$/i;

const segmentToNavKey: Record<string, string> = {
  users: "users",
  "audit-log": "auditLog",
  settings: "settings",
  profile: "profile",
  "recycling-bin": "recyclingBin",
  new: "create",
  // Paths that belong to no nav entry fall back to these (lib/nav/config.ts
  // names everything else).
  tickets: "tickets",
  jml: "jmlHome",
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

  const ctx = useNavContext();
  const navLabel = useNavLabel();
  const localeHref = useLocaleHref();

  const path = normalisePath(pathname, locales);
  // The head of the trail comes from the ONE nav config (module, then tab), so
  // a crumb reads exactly like the sidebar and the tab bar. The remaining
  // segments below the owning page are labelled as before.
  const head = navTrail(path, ctx);
  const restFrom = head?.restFrom ?? "/";
  const baseSegments = restFrom.split("/").filter(Boolean);
  const segments = path.split("/").filter(Boolean).slice(baseSegments.length);

  type Crumb = { key: string; node: React.ReactNode; isLast: boolean };

  // An unlabelled record id is not a crumb, it is a cuid. Nothing in the app
  // sets a dynamic label today, so `/people/<id>` rendered its own page as
  // "Cmt7n76cx00008z7dyiua00cc", and the drafting page carried the same noise
  // mid-trail. Dropping it leaves "Home / People", which is where you are — the
  // page heading already names the record. A LABELLED id still renders, so this
  // stops being a filter the moment a page supplies a name.
  const trail = segments
    .map((segment, index) => ({
      segment,
      path: `/${locale}/` + [...baseSegments, ...segments.slice(0, index + 1)].join("/"),
    }))
    .filter(({ segment }) => dynamicLabels[segment] || !OPAQUE_ID.test(segment));

  const headCrumbs: Crumb[] = (head?.crumbs ?? []).map((crumb, index, all) => {
    const isLast = trail.length === 0 && index === all.length - 1;
    const text = navLabel(crumb);
    return {
      key: `nav-${crumb.key}`,
      node:
        isLast || crumb.href === null ? (
          <span className={isLast ? "text-foreground" : "text-muted-foreground"}>{text}</span>
        ) : (
          <Link
            href={localeHref(crumb.href)}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {text}
          </Link>
        ),
      isLast,
    };
  });

  const items: Crumb[] = [
    {
      key: "__home",
      node: (
        <Link
          href={`/${locale}`}
          /*
            `-m-1 p-1` grows the TAP target to 24x24 without moving the icon a
            pixel: the padding expands the hit area, the negative margin pulls the
            layout back. Measured at 16x16 before, under the 24px WCAG 2.2 AA
            floor (2.5.8) — small enough to be a real miss on a phone, and it is
            the link back to the dashboard.
          */
          className="-m-1 inline-flex items-center p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={t("home")}
        >
          <Home className="h-4 w-4" />
        </Link>
      ),
      isLast: trail.length === 0 && headCrumbs.length === 0,
    },
    ...headCrumbs,
    ...trail.map(({ segment, path }, index) => {
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

      const isLast = index === trail.length - 1;
      // A grouping segment has no page of its own, so linking it produces a
      // breadcrumb that 404s when clicked — and a prefetch that 404s on every
      // render even when nobody clicks it. Rendered as plain text instead: it
      // still shows where you are, it just does not promise a destination that
      // was never built.
      const navigable = !NON_NAVIGABLE_SEGMENTS.has(segment) && !OPAQUE_ID.test(segment);

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
