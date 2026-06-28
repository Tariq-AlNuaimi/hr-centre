/**
 * jsdom shims for Ant Design under node:test.
 *
 * Loaded via `--import` AFTER global-jsdom/register, so `window` exists here.
 * AntD's responsive Table / Grid reach for browser APIs jsdom omits:
 *   - window.matchMedia  (responsive breakpoints)
 *   - ResizeObserver     (Table sticky / virtual measurements)
 *   - scrollTo / getComputedStyle quirks
 * Without these the very first responsive component render throws and every
 * Table-based test fails before it can assert anything.
 */

if (typeof window !== "undefined") {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as unknown as MediaQueryList;
  }

  if (typeof window.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver =
      ResizeObserverStub as unknown as typeof ResizeObserver;
    (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      window.ResizeObserver;
  }

  if (typeof window.scrollTo !== "function") {
    window.scrollTo = (() => {}) as typeof window.scrollTo;
  }
}
