/**
 * Render helper for component tests.
 *
 * Components in this template pull from two providers at runtime:
 *   - next-intl    (useTranslations)  -> NextIntlClientProvider + a messages object
 *   - React Query  (@tanstack)        -> QueryClientProvider (data hooks + the
 *                                         QueryProvider error bridge)
 *
 * `renderWithProviders` wraps both so a component under test behaves like it does
 * inside the dashboard. Tests stay resilient by asserting on visible text /
 * roles. (The template migrated off Ant Design in ADR-029 — no ConfigProvider/App
 * wrapper is needed; toasts now route through sonner, which no tested component
 * mounts at render.)
 *
 * jsdom is registered globally by the test script (global-jsdom/register), so the
 * DOM is already present when this module loads.
 */
import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mirrors messages/en.json closely enough for the shared components, which all
// read the "common" namespace. Extend per test if a component reaches wider.
export const messages = {
  common: {
    appName: "My App",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    create: "Create",
    search: "Search...",
    actions: "Actions",
    confirm: "Confirm",
    back: "Back",
    loading: "Loading...",
    noData: "No data found",
    yes: "Yes",
    no: "No",
    selectAll: "Select all rows",
    selectRow: "Select row",
    filter: "Filter",
    pageSize: "Rows per page",
    page: "page",
    prevPage: "Previous page",
    nextPage: "Next page",
    somethingWentWrong: "Something went wrong",
    unexpectedError: "An unexpected error occurred. Please try again.",
    tryAgain: "Try Again",
    backHome: "Back Home",
  },
  // Branded status pages (BrandedStatus) read this namespace.
  status: {
    forbiddenTitle: "Access denied",
    forbiddenSubtitle: "You don't have permission to view this page.",
    maintenanceTitle: "We'll be right back",
    maintenanceSubtitle:
      "The app is undergoing scheduled maintenance. Please check back shortly.",
    notFoundTitle: "Page not found",
    errorTitle: "Something went wrong",
    errorSubtitle: "An unexpected error occurred. Please try again.",
  },
  // Chrome (AppHeader / CommandPalette / NotificationsMenu / OrgSwitcher).
  chrome: {
    search: "Search or jump to…",
    openCommand: "Open command menu",
    commandPlaceholder: "Search pages and actions…",
    noResults: "No matching commands",
    groupNavigate: "Navigate",
    groupActions: "Actions",
    actionToggleTheme: "Toggle light / dark",
    actionLogout: "Sign out",
    notifications: "Notifications",
    noNotifications: "You're all caught up",
    noNotificationsHint: "New notifications will appear here.",
    switchWorkspace: "Switch workspace",
    singleWorkspaceHint: "You're in your only workspace.",
  },
  // DataView selection/column controls.
  data: {
    selected: "{count} selected",
    clearSelection: "Clear",
    columns: "Columns",
  },
};

type ProviderOptions = {
  locale?: string;
  messages?: Record<string, Record<string, string>>;
};

export function Providers({
  children,
  locale = "en",
  messages: msgs = messages,
}: { children: ReactNode } & ProviderOptions) {
  // A fresh QueryClient per render keeps tests isolated (no cache bleed between
  // cases), and retry:false makes a failed query settle immediately instead of
  // hanging the test on backoff. Mirrors the runtime QueryProvider (ADR-021).
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <NextIntlClientProvider locale={locale} messages={msgs}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options: ProviderOptions = {},
) {
  return render(
    <Providers locale={options.locale} messages={options.messages}>
      {ui}
    </Providers>,
  );
}

export * from "@testing-library/react";
