// Root-level not-found for paths that never reach the `[locale]` segment
// (e.g. the synthetic `/_not-found` page Next prerenders at build time).
// Self-contained -- renders its own <html>/<body> and uses no React context,
// so it prerenders without the locale/theme providers that only exist under
// `app/[locale]`. Locale-aware 404s live in `app/[locale]/not-found.tsx`.
export default function RootNotFound() {
  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          fontFamily: "sans-serif",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h2>404 — Page not found</h2>
          <p>
            {/*
              Plain anchor on purpose: this root 404 renders OUTSIDE the Next
              router/locale context (see file header), so next/link's <Link>
              has no router to consume. eslint-disable is the documented escape
              hatch for the one route that legitimately can't use <Link>.
            */}
            {/* Bare root, not a hardcoded /en: app/page.tsx redirects "/" to
                the configured default locale. This file is context-free (can't
                import config), so "/" is the locale-agnostic safe target. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/">Go home</a>
          </p>
        </div>
      </body>
    </html>
  );
}
