"use client";

import { useState, useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { useNotify } from "@/hooks/use-notify";
import { notifyQueryError, registerQueryErrorNotifier } from "@/lib/query-error-notifier";

// Client-side data layer (ADR-021). One QueryClient per browser session: created
// in useState so it survives re-renders but is NOT shared across requests/users
// (a module-level singleton would leak one user's cache into another during SSR).
//
// Defaults tuned for an internal prototype dashboard:
//   - staleTime 30s: a freshly-fetched list/detail is reused for half a minute
//     before a background refetch, so tab-switching doesn't refetch constantly.
//   - retry 1: one retry smooths a transient blip without hammering a route that
//     is genuinely down (the API surfaces real errors via ApiError).
//   - refetchOnWindowFocus off: focus-refetch is noisy for an internal tool; the
//     mutation invalidations in use-entity-queries keep lists fresh after writes.
//
// Read errors surface through the QueryCache onError below: it fires once per
// actual failed fetch (never on a mount that replays a cached error), using the
// per-query `meta.errorMessage` the hooks set. Mutations handle their own errors
// at the call site (mutateAsync try/catch), so they opt out here.
function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        const message = query.meta?.errorMessage;
        if (typeof message === "string") notifyQueryError(message);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

// Registers the live AntD notifier (App context, via useNotify) with the
// module-level bridge the QueryCache reads. Rendered inside the App provider.
function QueryErrorBridge() {
  const { error } = useNotify();
  useEffect(() => {
    registerQueryErrorNotifier(error);
    return () => registerQueryErrorNotifier(null);
  }, [error]);
  return null;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={client}>
      <QueryErrorBridge />
      {children}
    </QueryClientProvider>
  );
}
