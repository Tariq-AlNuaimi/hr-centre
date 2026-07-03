"use client";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { brand } from "@/brand.config";

/**
 * Workspace / org switcher (top-left chrome). The template is single-tenant, so
 * this shows the one brand workspace with an honest "only workspace" hint rather
 * than faking tenants. A multi-tenant fork feeds real orgs into the menu and
 * wires selection — the control + interaction model are already here.
 */
export function OrgSwitcher() {
  const t = useTranslations("chrome");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("switchWorkspace")}
          className="inline-flex items-center gap-2.5 rounded-md px-2 py-1 text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[15px] font-bold leading-none text-primary-foreground"
          >
            {brand.monogram}
          </span>
          <span className="text-base font-semibold tracking-[-0.01em]">
            {brand.appName}
          </span>
          <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem>
          <Check className="text-primary" />
          {brand.appName}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {t("singleWorkspaceHint")}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
