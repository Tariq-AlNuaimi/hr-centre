"use client";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Lock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { brand } from "@/brand.config";
import { visibleNav } from "@/lib/nav/resolve";
import { useNavContext } from "./use-nav-context";

/**
 * The "HR Centre" switcher is the MODULE LAUNCHER (docs/blueprints/ux-p0.md,
 * AC-5.1). Every module is listed whether or not the viewer may open it: the
 * sidebar only shows what a role grants, so before this a platform admin with
 * no Hiring role had no hint that Hiring existed. A module without access says
 * so plainly, and a platform admin — the person who can fix it — is taken to
 * Admin → Roles. Where each module opens comes from the one nav config
 * (lib/nav/config.ts): the first destination in it this viewer may open.
 */
type Module = { key: string; href: string | null };

/** For each module, the nav keys (entries or tabs) that open it, in preference order. */
const MODULE_DOORS: ReadonlyArray<[string, readonly string[]]> = [
  ["people", ["people"]],
  ["performance", ["me-performance"]],
  ["jml", ["jml"]],
  ["hiring", ["hiring", "me-interviews", "hiring-insights"]],
  ["tickets", ["tickets", "ticket-reports", "ticket-setup"]],
];

function useModules(): Module[] {
  const ctx = useNavContext();
  const hrefs = new Map<string, string>();
  for (const entry of visibleNav(ctx)) {
    hrefs.set(entry.key, entry.href);
    for (const tab of entry.tabs) hrefs.set(tab.key, tab.href);
  }
  return MODULE_DOORS.map(([key, doors]) => ({
    key,
    href: doors.map((d) => hrefs.get(d)).find((h) => h !== undefined) ?? null,
  }));
}

export function OrgSwitcher() {
  const t = useTranslations("chrome");
  const tm = useTranslations("chrome.modules");
  const router = useRouter();
  const locale = useLocale();
  const { data: session } = useSession();
  const isPlatformAdmin = session?.user?.role === "ADMIN";
  const modules = useModules();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("switchModule")}
          className="inline-flex items-center gap-2.5 rounded-md px-2 py-1 text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-base font-bold leading-none text-primary-foreground"
          >
            {brand.monogram}
          </span>
          <span className="text-base font-semibold tracking-[-0.01em]">{brand.appName}</span>
          <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{t("modulesTitle")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {modules.map((m) => {
          const open = m.href !== null;
          if (open) {
            return (
              <DropdownMenuItem key={m.key} onSelect={() => router.push(`/${locale}${m.href}`)}>
                <span className="flex flex-col">
                  <span className="font-medium">{tm(`${m.key}.name`)}</span>
                  <span className="text-xs text-muted-foreground">{tm(`${m.key}.hint`)}</span>
                </span>
              </DropdownMenuItem>
            );
          }
          return isPlatformAdmin ? (
            <DropdownMenuItem key={m.key} onSelect={() => router.push(`/${locale}/admin/roles`)}>
              <Lock aria-hidden className="text-muted-foreground" />
              <span className="flex flex-col">
                <span className="font-medium">{tm(`${m.key}.name`)}</span>
                <span className="text-xs text-muted-foreground">{t("noAccessAdmin")}</span>
              </span>
            </DropdownMenuItem>
          ) : (
            <div key={m.key} className="flex items-start gap-2 px-2 py-1.5 text-sm">
              <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex flex-col">
                <span className="font-medium text-muted-foreground">{tm(`${m.key}.name`)}</span>
                <span className="text-xs text-muted-foreground">{t("noAccess")}</span>
              </span>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
