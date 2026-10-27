"use client";

import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { NotificationList } from "@/components/pms/NotificationList";
import { useNotifications } from "@/hooks/use-notifications";

/**
 * Header notifications bell.
 *
 * The template shipped this as finished chrome with `count = 0` and an honest
 * empty state, waiting for a fork to bring a feed. This fork's feed is §5.5's
 * escalation ladder (`lib/pms/cycle-notify.ts`), which needed an in-app channel
 * because email is unconfigured on this deployment and the ladder was reaching
 * nobody.
 *
 * The bell is in the header rather than only on the dashboard for one specific
 * person: the skip-level manager. §5.5 escalates to them because they have "the
 * authority to compel action", and they have no §4.4 task row to discover it
 * through — so the notice has to find them wherever they are in the app.
 */
export function NotificationsMenu() {
  const t = useTranslations("chrome");
  const tn = useTranslations("pms.notifications");
  const [open, setOpen] = useState(false);
  const { items, unread, isLoading, isError, markRead, dismiss } = useNotifications();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          // The count belongs in the accessible name, not only in the badge: a
          // screen-reader user should hear "Notifications, 3 unread" from the
          // trigger rather than have to open the panel to find out there is
          // anything in it.
          aria-label={unread > 0 ? tn("bellWithCount", { count: unread }) : t("notifications")}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            // Micro count badge inside a 16px (h-4) dot — 10px keeps a 2-digit
            // count legible without overflowing; the type scale's floor (text-xs
            // / 12px) would clip it. A justified sub-scale one-off.
            // eslint-disable-next-line rihal-template/no-arbitrary-className
            <span className="absolute end-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground">
              {/* Past 9 the exact number stops changing what anyone does next,
                  and a three-digit count bursts a 16px dot. */}
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-foreground">{t("notifications")}</span>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markRead.mutate({ all: true })}
              disabled={markRead.isPending}
            >
              {tn("markAllRead")}
            </Button>
          ) : null}
        </div>

        {isError ? (
          <p role="alert" className="px-3 py-6 text-center text-sm text-destructive-emphasis">
            {tn("loadFailed")}
          </p>
        ) : isLoading ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{tn("loading")}</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
            <Bell className="mb-1 h-6 w-6 text-muted-foreground/60" />
            <div className="text-sm text-foreground">{t("noNotifications")}</div>
            <div className="text-xs text-muted-foreground">{t("noNotificationsHint")}</div>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <NotificationList
              items={items}
              onOpen={(id) => {
                setOpen(false);
                markRead.mutate({ ids: [id] });
              }}
              onDismiss={(id) => dismiss.mutate(id)}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
