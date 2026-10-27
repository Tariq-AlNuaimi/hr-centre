"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { locales } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { normalisePath, tabsFor } from "@/lib/nav/resolve";
import { useLocaleHref, useNavContext, useNavLabel } from "./use-nav-context";

/**
 * The module's in-page tab bar (UX review R7): a module is one sidebar entry,
 * and its sub-pages are these tabs. Rendered once by the shell for whichever
 * module owns the current path (lib/nav/resolve.ts `tabsFor`); nothing renders
 * when the module has fewer than two tabs this viewer may open. Scrolls
 * horizontally on a narrow screen instead of wrapping.
 */
export function ModuleTabs() {
  const pathname = usePathname();
  const ctx = useNavContext();
  const label = useNavLabel();
  const href = useLocaleHref();
  const t = useTranslations("nav");
  const found = tabsFor(normalisePath(pathname, locales), ctx);
  if (!found) return null;
  const { entry, activeTab } = found;

  return (
    <nav
      aria-label={t("moduleTabs", { module: label(entry) })}
      className="-mt-1 mb-5 overflow-x-auto border-b border-border"
    >
      <ul className="flex min-w-max gap-1">
        {entry.tabs.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <li key={tab.key}>
              <Link
                href={href(tab.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex border-b-2 px-3 py-2 text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label(tab)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
