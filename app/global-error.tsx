"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { brand } from "@/brand.config";

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
    <html lang="en">
      <body
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          margin: 0,
          background: "rgb(251, 251, 252)",
          color: "rgb(17, 24, 39)",
          fontFamily: brand.font.fallback,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 12,
              background: brand.colors.primary,
              color: "rgb(255, 255, 255)",
              fontSize: 24,
              fontWeight: 700,
              marginBottom: 20,
            }}
          >
            {brand.monogram}
          </span>
          <h2
            style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}
          >
            Something went wrong
          </h2>
          <p
            style={{
              margin: "0 0 24px",
              color: "rgb(91, 100, 114)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "9px 20px",
              cursor: "pointer",
              background: brand.colors.primary,
              color: "rgb(255, 255, 255)",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
