"use client";

import { Menu as MenuIcon, PanelLeftClose } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { locales } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { activeNav, groupedNav, normalisePath } from "@/lib/nav/resolve";
import { navIcon, useLocaleHref, useNavContext, useNavLabel } from "./use-nav-context";

/**
 * The sidebar is generated from `lib/nav/config.ts` (docs/blueprints/ux-p1-nav.md):
 * task-based groups (Home · Me · My team · People · Talent · Service · Insights ·
 * Admin), ONE entry per module — a module's sub-pages are its in-page tab bar
 * (`ModuleTabs`), not more sidebar rows. A group renders only when it has an
 * entry this viewer may open; gates fail closed while access is loading.
 */
export function AppSidebar() {
  const t = useTranslations("nav");
  const tChrome = useTranslations("chrome");
  const router = useRouter();
  const pathname = usePathname();
  const ctx = useNavContext();
  const label = useNavLabel();
  const href = useLocaleHref();
  const [collapsed, setCollapsed] = useState(false);

  // Mirror the lg breakpoint (992px): auto-collapse to icons below it, while
  // still allowing a manual toggle above it.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 991px)");
    const apply = (matches: boolean) => setCollapsed(matches);
    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const activeKey = activeNav(normalisePath(pathname, locales), ctx)?.entryKey ?? null;

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-e border-border bg-card pt-2 transition-[width] duration-200",
        collapsed ? "w-16" : "w-56",
      )}
    >
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2" aria-label={t("mainNav")}>
        {groupedNav(ctx).map(({ group, entries }) => (
          <div key={group} className="flex flex-col gap-1">
            {group !== "home" && !collapsed ? (
              <p className="mt-3 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`group.${group}`)}
              </p>
            ) : null}
            {group !== "home" && collapsed ? <hr className="my-2 border-border" /> : null}
            {entries.map((entry) => {
              const isActive = entry.key === activeKey;
              const text = label(entry);
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => router.push(href(entry.href))}
                  aria-current={isActive ? "page" : undefined}
                  title={collapsed ? text : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    collapsed && "justify-center",
                    isActive
                      ? "bg-accent-subtle font-medium text-nav-active-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="inline-flex shrink-0">{navIcon(entry.icon)}</span>
                  {!collapsed && <span className="truncate">{text}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={tChrome("toggleSidebar")}
          aria-expanded={!collapsed}
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center",
          )}
        >
          {collapsed ? <MenuIcon className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
