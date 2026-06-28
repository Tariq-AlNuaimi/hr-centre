// Bridges TanStack Query's cache-level error events (QueryProvider's QueryCache
// onError) to the AntD notification system, which is only reachable from React
// (App context, via useNotify). The QueryCache lives outside React, so it can't
// call a hook directly; instead a small client component (QueryErrorBridge)
// registers the live notifier here once it's mounted inside the App provider.
//
// Why a cache-level handler instead of a per-page `if (isError) toast` effect:
// onError fires once per ACTUAL failed fetch (never on a mount that replays a
// cached error), so distinct failures each surface exactly one toast and a
// stale cached error never flashes a toast on remount (ADR-021).
//
// Module-global is safe here: error toasts only fire client-side (the queryFn
// runs in the browser), and there is one user per browser tab.

type Notifier = (message: string) => void;

let current: Notifier | null = null;

export function registerQueryErrorNotifier(fn: Notifier | null): void {
  current = fn;
}

export function notifyQueryError(message: string): void {
  current?.(message);
}
