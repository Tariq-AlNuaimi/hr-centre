"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { BrandedStatus } from "@/components/shared/BrandedStatus";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  const tStatus = useTranslations("status");

  useEffect(() => {
    // Log + report the real error; never render it to the user (it can carry
    // Restricted detail). We call @sentry/nextjs directly here rather than the
    // lib/sentry wrapper: this is a client boundary, and the wrapper's
    // SCRUB_FIELDS import pulls server-only Prisma code into the browser bundle.
    // The error object itself carries no app context to scrub here.
    //
    // Wrapped in try/catch: an error boundary must never throw (e.g. if Sentry
    // isn't initialized), or React unwinds to the next boundary and the user
    // sees a blank screen instead of this fallback.
    try {
      console.error(error);
      if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
        // Loaded on demand (ADR-088): with no DSN the SDK never reaches the browser.
        void import("@sentry/nextjs").then((S) => S.captureException(error)).catch(() => {});
      }
    } catch {
      /* swallow -- the boundary's job is to render, not to crash */
    }
  }, [error]);

  return (
    <BrandedStatus
      title={tStatus("errorTitle")}
      subtitle={tStatus("errorSubtitle")}
      actions={<Button onClick={reset}>{t("tryAgain")}</Button>}
    />
  );
}
