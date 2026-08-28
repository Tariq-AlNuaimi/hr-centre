"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

/**
 * The header bell and the §4.4 My Tasks card read the SAME feed through this
 * hook, so the badge and the list can never disagree about what is unread.
 *
 * Notifications are the app's own channel for §5.5's escalation ladder — see
 * `lib/pms/cycle-notify.ts` for why that ladder needed one.
 */

export type NotificationKind =
  "CYCLE_REMINDER" | "CYCLE_ESCALATION" | "HR_INTERVENTION" | "THREE_SIXTY_REMINDER";

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  body: string;
  /** Locale-LESS path from the server; the caller prefixes its own locale. */
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationFeed = { items: NotificationItem[]; unread: number };

export const NOTIFICATIONS_KEY = ["notifications", "mine"] as const;

/**
 * Polled rather than pushed.
 *
 * The producer is a cron that runs ONCE a day (`vercel.json`), so the feed
 * changes at most daily and a socket would be a standing connection to carry
 * one message. Five minutes is far below that cadence and is really about the
 * other direction: a tab left open overnight should not still be showing
 * yesterday's badge. `refetchOnWindowFocus` does the rest for free.
 */
const POLL_MS = 5 * 60_000;

export function useNotifications() {
  const query = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => apiClient.get<NotificationFeed>("/api/notifications"),
    refetchInterval: POLL_MS,
  });

  const client = useQueryClient();
  const markRead = useMutation({
    mutationFn: (input: { ids: string[] } | { all: true }) =>
      apiClient.post<{ updated: number }>("/api/notifications/read", input),
    // Refetch rather than patch the cache by hand: the unread COUNT is a server
    // read over every unread row, not over the twenty this page happens to
    // hold, so recomputing it client-side would be wrong for anyone with more
    // than a page of them.
    onSuccess: () => client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  return {
    items: query.data?.items ?? [],
    unread: query.data?.unread ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    markRead,
  };
}
