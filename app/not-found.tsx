import { brand } from "@/brand.config";

// Root-level not-found for paths that never reach the `[locale]` segment
// (e.g. the synthetic `/_not-found` page Next prerenders at build time).
// Self-contained -- renders its own <html>/<body> and uses NO React context
// (no providers / next-intl / theme), so it prerenders without the
// locale/theme providers that only exist under `app/[locale]`. Importing the
// static `brand` config object is safe here (it is plain data, not a provider);
// the thing that must never be imported is anything that calls useContext.
// Locale-aware 404s live in `app/[locale]/not-found.tsx`.
//
// Styling is inline because this tree never loads app/globals.css (so the
// design tokens are unavailable). Neutrals use rgb() literals mirroring the
// light-theme tokens (--background #fbfbfc, --foreground #111827,
// --muted-foreground #5b6472) so no-raw-hex-color stays satisfied; the brand
// color + monogram + font come from brand.config, so a rebrand flows through.
export default function RootNotFound() {
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
            Page not found
          </h2>
          <p
            style={{
              margin: "0 0 24px",
              color: "rgb(91, 100, 114)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
          </p>
          {/*
            Plain anchor on purpose: this root 404 renders OUTSIDE the Next
            router/locale context (see file header), so next/link's <Link> has
            no router to consume. Bare root, not a hardcoded /en: app/page.tsx
            redirects "/" to the configured default locale, so "/" is the
            locale-agnostic safe target. eslint-disable is the documented
            escape hatch for the one route that legitimately can't use <Link>.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              display: "inline-block",
              padding: "9px 20px",
              background: brand.colors.primary,
              color: "rgb(255, 255, 255)",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Go home
          </a>
        </div>
      </body>
    </html>
  );
}
