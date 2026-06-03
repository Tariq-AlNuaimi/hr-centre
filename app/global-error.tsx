"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Deliberately context-free (no providers / next-intl / Ant): this is the
// last-resort boundary that renders even when the locale tree fails. Strings
// are plain English. We call @sentry/nextjs directly (not the lib/sentry
// wrapper) because this is a client bundle and the wrapper's SCRUB_FIELDS
// import would pull server-only Prisma code into the browser. We log + report
// the real error but never render it.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h2>Something went wrong</h2>
          <p>An unexpected error occurred. Please try again.</p>
          <button
            onClick={reset}
            style={{
              padding: "8px 16px",
              cursor: "pointer",
              marginTop: 16,
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
