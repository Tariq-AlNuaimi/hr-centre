"use client";

import { useEffect } from "react";
import { Result, Button } from "antd";
import { useTranslations } from "next-intl";
import * as Sentry from "@sentry/nextjs";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

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
      Sentry.captureException(error);
    } catch {
      /* swallow -- the boundary's job is to render, not to crash */
    }
  }, [error]);

  return (
    <Result
      status="error"
      title={t("somethingWentWrong")}
      subTitle={t("unexpectedError")}
      extra={
        <Button type="primary" onClick={reset}>
          {t("tryAgain")}
        </Button>
      }
    />
  );
}
