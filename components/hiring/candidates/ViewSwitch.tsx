"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { KanbanSquare, List } from "lucide-react";
import { cn } from "@/lib/utils";

/** List ⇄ Board (Interview Hub CandidatesViewSwitcher; its "Talent pool" view was dropped). */
export function ViewSwitch({ active }: { active: "list" | "board" }) {
  const t = useTranslations("hiring.candidates");
  const locale = useLocale();
  const items = [
    { key: "list", href: `/${locale}/hiring/candidates`, label: t("viewList"), icon: List },
    { key: "board", href: `/${locale}/hiring/pipeline`, label: t("viewBoard"), icon: KanbanSquare },
  ] as const;
  return (
    <nav aria-label={t("viewSwitch")} className="inline-flex rounded-md border border-border p-0.5">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={active === i.key ? "page" : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded px-3 py-1 text-sm",
            active === i.key
              ? "bg-accent-subtle font-medium text-primary-emphasis"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <i.icon aria-hidden className="h-4 w-4" />
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
