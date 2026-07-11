"use client";

import {
  Home,
  User,
  Settings,
  Trash2,
  ClipboardCheck,
  Menu as MenuIcon,
  PanelLeftClose,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { localePrefixRegex } from "@/i18n/config";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const t = useTranslations("nav");
  const tChrome = useTranslations("chrome");
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(false);

  // Mirror AntD Sider `breakpoint="lg"` (992px): auto-collapse to icons below
  // the lg breakpoint, while still allowing a manual toggle above it.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 991px)");
    const apply = (matches: boolean) => setCollapsed(matches);
    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // types/index.ts augments next-auth's Session.user with role: Role,
  // so this access is typed -- no `as any` needed.
  const isAdmin = session?.user?.role === "ADMIN";

  // Strip locale prefix for active key matching
  const activeKey = pathname.replace(localePrefixRegex, "").split("/").filter(Boolean)[0] ?? "home";

  const menuItems = [
    {
      key: "home",
      icon: <Home className="h-4 w-4" />,
      label: t("home"),
      onClick: () => router.push(`/${locale}`),
    },
    ...(isAdmin
      ? [
          {
            key: "users",
            icon: <User className="h-4 w-4" />,
            label: t("users"),
            onClick: () => router.push(`/${locale}/users`),
          },
          {
            key: "audit-log",
            icon: <ClipboardCheck className="h-4 w-4" />,
            label: t("auditLog"),
            onClick: () => router.push(`/${locale}/audit-log`),
          },
        ]
      : []),
    {
      key: "recycling-bin",
      icon: <Trash2 className="h-4 w-4" />,
      label: t("recyclingBin"),
      onClick: () => router.push(`/${locale}/recycling-bin`),
    },
    {
      key: "settings",
      icon: <Settings className="h-4 w-4" />,
      label: t("settings"),
      onClick: () => router.push(`/${locale}/settings`),
    },
    // NOTE: scaffolded entity nav entries are inserted before the recycling-bin
    // item above (see scripts/scaffold-entity.mjs patchSidebar marker) -- keep
    // that literal intact.
  ].filter((item) => item.key !== "recycling-bin" || isAdmin); // bin is admin-only (API is withAdminAuth)

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-e border-border bg-card pt-2 transition-[width] duration-200",
        collapsed ? "w-16" : "w-56",
      )}
    >
      <nav className="flex flex-1 flex-col gap-1 px-2">
        {menuItems.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                collapsed && "justify-center",
                isActive
                  ? "bg-muted font-medium text-nav-active-foreground"
                  : "text-foreground hover:bg-muted",
              )}
            >
              <span className="inline-flex shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
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
