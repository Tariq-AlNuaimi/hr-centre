"use client";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * Header notifications bell. The template ships no notifications backend, so the
 * panel shows an HONEST empty state ("all caught up") rather than fake rows — a
 * fork wires a real feed (e.g. via /scale-up) and feeds `items` here. The count
 * badge + panel are the finished chrome; the data source is the seam.
 */
export function NotificationsMenu() {
  const t = useTranslations("chrome");
  const [open, setOpen] = useState(false);

  // No feed yet — keep this empty (honest) until a real source is wired.
  const count = 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          aria-label={t("notifications")}
        >
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute end-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-foreground">
            {t("notifications")}
          </span>
        </div>
        <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
          <Bell className="mb-1 h-6 w-6 text-muted-foreground/60" />
          <div className="text-sm text-foreground">{t("noNotifications")}</div>
          <div className="text-xs text-muted-foreground">
            {t("noNotificationsHint")}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
