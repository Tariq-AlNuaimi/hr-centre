/**
 * Render helper for component tests.
 *
 * Components in this template pull from two providers at runtime:
 *   - next-intl  (useTranslations) -> NextIntlClientProvider + a messages object
 *   - Ant Design (App / theme)      -> ConfigProvider + App so message/modal APIs
 *                                       and the React 19 wave effect don't warn
 *
 * `renderWithProviders` wraps both so a component under test behaves like it does
 * inside the dashboard. Tests stay resilient by asserting on visible text / roles
 * rather than AntD's internal DOM structure.
 *
 * jsdom is registered globally by the test script (global-jsdom/register), so the
 * DOM is already present when this module loads.
 */
import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { App, ConfigProvider } from "antd";
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
    somethingWentWrong: "Something went wrong",
    unexpectedError: "An unexpected error occurred. Please try again.",
    tryAgain: "Try Again",
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
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <App>{children}</App>
        </ConfigProvider>
      </QueryClientProvider>
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
