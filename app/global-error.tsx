"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
          <p>{error.message}</p>
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
