"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, NAV_SECTIONS } from "./nav";

export function SidebarNav({
  isAdmin,
  onNavigate,
}: {
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const visible = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin);

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  return (
    <nav className="flex flex-col gap-6" aria-label={t("dashboard")}>
      {NAV_SECTIONS.map((section) => {
        const items = visible.filter((i) => i.section === section.id);
        if (items.length === 0) return null;
        return (
          <div key={section.id} className="flex flex-col gap-1">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              {t(section.labelKey)}
            </p>
            {items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-accent" : "text-muted-foreground"
                    )}
                  />
                  <span className="truncate">{t(item.key)}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
