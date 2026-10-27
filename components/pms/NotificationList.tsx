"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Bell, Clock, MessageSquare, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NotificationItem, NotificationKind } from "@/hooks/use-notifications";

/**
 * One rendering of the feed, used by BOTH the header bell and the §4.4 My Tasks
 * card, so the two cannot drift into showing the same event differently.
 *
 * The heading is derived from `kind` and translated; the sentence underneath is
 * the machine's own English `detail`, exactly as §5.6 stores it on
 * `ComplianceEvent` and §11.2 already shows HR. One machine-written sentence,
 * one representation of it — a second, translated copy of the ladder's prose
 * would be a second thing to keep true.
 *
 * WHAT THIS IS NOT: a task list. §4.4's My Tasks answers "what is waiting on
 * me"; this answers "what was I told". A skip-level manager's escalation is the
 * clearest case of the difference — it is not their set to draft, and it must
 * still reach them.
 */

/** Kinds without an entry here (JML, HR tickets…) fall back to the bell — never a crash. */
const KIND_ICON: Partial<Record<NotificationKind, typeof Bell>> = {
  CYCLE_REMINDER: Clock,
  CYCLE_ESCALATION: AlertTriangle,
  HR_INTERVENTION: AlertTriangle,
  THREE_SIXTY_REMINDER: MessageSquare,
};

const KIND_VARIANT: Partial<Record<NotificationKind, "warning" | "danger" | "brand">> = {
  CYCLE_REMINDER: "warning",
  CYCLE_ESCALATION: "danger",
  HR_INTERVENTION: "danger",
  THREE_SIXTY_REMINDER: "brand",
};

function DismissButton({ id, onDismiss }: { id: string; onDismiss: (id: string) => void }) {
  const t = useTranslations("pms.notifications");
  return (
    <button
      type="button"
      onClick={() => onDismiss(id)}
      aria-label={t("dismiss")}
      title={t("dismiss")}
      className="m-2 shrink-0 self-start rounded p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}

export function NotificationRow({
  item,
  onOpen,
  onDismiss,
}: {
  item: NotificationItem;
  onOpen?: (id: string) => void;
  onDismiss?: (id: string) => void;
}) {
  const t = useTranslations("pms.notifications");
  const locale = useLocale();
  const Icon = KIND_ICON[item.kind] ?? Bell;
  const unread = item.readAt === null;

  const inner = (
    <>
      <span className={cn("mt-0.5 shrink-0", unread ? "text-foreground" : "text-muted-foreground")}>
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <span className="min-w-0 space-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-sm text-foreground",
              // Weight, not colour, carries unread: a colour-only signal fails
              // WCAG 1.4.1 and dies in the dark theme's flatter palette.
              unread ? "font-semibold" : "font-normal",
            )}
          >
            {t(`kind.${item.kind}`)}
          </span>
          {unread ? (
            <Badge variant={KIND_VARIANT[item.kind] ?? "brand"}>{t("unread")}</Badge>
          ) : null}
        </span>
        <span className="block max-w-prose text-xs text-muted-foreground">{item.body}</span>
        <span className="block text-xs text-muted-foreground">
          {formatDateTime(item.createdAt)}
        </span>
      </span>
    </>
  );

  // A notification with nowhere to go is still worth reading — the HR digest
  // names a queue, and §5.5's third rung is a decision, not a link. Rendering
  // it as a dead link would be a 24×24 target that does nothing (WCAG 2.5.8's
  // spirit, if not its letter).
  if (!item.href) {
    return (
      <li className="flex min-h-6 items-start gap-3 border-b border-border px-3 py-3 last:border-b-0">
        {inner}
        {onDismiss ? <DismissButton id={item.id} onDismiss={onDismiss} /> : null}
      </li>
    );
  }

  return (
    <li className="flex items-start border-b border-border last:border-b-0">
      <Link
        href={`/${locale}${item.href}`}
        onClick={() => onOpen?.(item.id)}
        // `bg-muted`, not `bg-accent`: `--accent` is the brand blue as a SOLID
        // (it is `--brand-accent`, a text/emphasis colour), so hovering painted
        // the row royal and left the text at #111827 on it — measured at
        // rgb(1,101,255) under rgb(17,24,39) in a real browser, which is a
        // contrast failure, not a style preference. `bg-muted` is what every
        // other hoverable row in the app uses.
        className="flex min-h-6 min-w-0 flex-1 items-start gap-3 px-3 py-3 outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {inner}
      </Link>
      {onDismiss ? <DismissButton id={item.id} onDismiss={onDismiss} /> : null}
    </li>
  );
}

export function NotificationList({
  items,
  onOpen,
  onDismiss,
  className,
}: {
  items: readonly NotificationItem[];
  onOpen?: (id: string) => void;
  onDismiss?: (id: string) => void;
  className?: string;
}) {
  return (
    <ul className={cn("flex list-none flex-col p-0", className)}>
      {items.map((item) => (
        <NotificationRow key={item.id} item={item} onOpen={onOpen} onDismiss={onDismiss} />
      ))}
    </ul>
  );
}
