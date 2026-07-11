# Recipe: Nonce-based CSP (drop `'unsafe-inline'` on script-src)

> `/scale-up` → shared-tier security checklist item **#3** (SECURITY.md §16).
> Tightens finding **T-05** (the conservative CSP shipped with `'unsafe-inline'`
> for Ant Design SSR + Next bootstrap). Removing inline-script execution removes
> the biggest XSS-amplification surface.

## When to add it

Add this when the fork is `shared`-tier and approaching handoff, **or** any time you
want a real defense-in-depth CSP rather than the conservative starter. Be honest
about the cost: Ant Design v6's emotion-based CSS-in-JS makes the **style-src** side
hard, so this recipe drops `'unsafe-inline'` from **script-src** (the high-value
win — inline script is what XSS payloads exploit) and **keeps the style-src caveat**
documented. Full style nonce-ing waits for AntD 7 (already an ADR-001 migration
trigger).

## What changes

1. **`middleware.ts`** generates a fresh nonce per request and sets the CSP header
   (a static `next.config.ts` header can't carry a per-request nonce) on **both** the
   response **and** the forwarded request headers. Next.js reads the nonce from the
   **request** CSP header and auto-applies it to the scripts it emits — this is what
   makes `'strict-dynamic'` work (the browser ignores `'self'` and trusts only nonce'd
   scripts + what they load, so Next's bootstrap must be nonced).
2. **`app/[locale]/layout.tsx`** reads the nonce and puts it on the inline
   `THEME_INIT_SCRIPT`. That is the only app change. AntD's stock `AntdRegistry` is
   left **as-is**: its SSR `<style>` tags fall under `style-src 'unsafe-inline'` (kept
   for AntD 6 emotion), so they need no nonce. **Only scripts are nonced.**

No new dependency to install.

> **Why no custom style registry?** Earlier drafts of this recipe threaded the nonce
> into `@ant-design/cssinjs` `StyleProvider`. Two problems: the installed cssinjs
> version's `StyleProvider` has no `nonce` prop (typecheck fails), and — more
> fundamentally — it buys nothing while `style-src` keeps `'unsafe-inline'` (which it
> must on AntD 6, see below). So we don't touch the registry at all.

## Change 1 — `next.config.ts`: stop emitting the script CSP statically

The static header can't hold a nonce, so move the **script** directive out of
`next.config.ts` and let middleware own the whole CSP. Keep the _other_ security
headers in `next.config.ts` (they're static and fine). Edit the `csp` array — delete
the `script-src` line (middleware will set the full policy):

```ts
// next.config.ts — REMOVE Content-Security-Policy from securityHeaders; middleware
// now sets it per-request. Keep the rest.
const securityHeaders = [
  // { key: "Content-Security-Policy", value: csp },  <-- DELETE this line
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];
```

Leave the `csp`/`isDev` consts unused-deleted or repurpose them in middleware (the
recipe rebuilds the policy there). Update the T-05 caveat comment to point at
middleware.

## Change 2 — `middleware.ts`: per-request nonce + CSP header

The template's `middleware.ts` runs on the **Node runtime** (`export const runtime =
"nodejs"`) — good, `node:crypto` is available. Generate the nonce, attach it to the
request (so the layout can read it) and to the response CSP. Insert at the top of the
`auth((req) => { ... })` callback, before the existing routing logic, and thread the
nonce through the responses.

```ts
// middleware.ts
export const runtime = "nodejs";

import createMiddleware from "next-intl/middleware";
import { auth } from "./lib/auth";
import { routing } from "./i18n/routing";
import { localePrefixRegex } from "./i18n/config"; // config-driven /<locale> prefix
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

const intlMiddleware = createMiddleware(routing);

// ...publicPaths / isPublicPath unchanged...

const isDev = process.env.NODE_ENV !== "production";

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // Nonce + strict-dynamic: inline bootstrap/theme scripts must carry the nonce;
    // scripts they load inherit trust. 'unsafe-inline' is IGNORED by browsers when a
    // nonce is present, so we leave it out of script-src entirely.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // STYLE caveat (T-05, unchanged): Ant Design v6 + emotion emit inline
    // style="..." attributes a nonce can't cover, so 'unsafe-inline' STAYS on
    // style-src until AntD 7. We do NOT nonce styles at all (the stock AntdRegistry
    // is untouched). Documented in SECURITY.md §4.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The template also appends the Sentry ingest origin here when
    // NEXT_PUBLIC_SENTRY_DSN is set (so error envelopes aren't CSP-blocked).
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

// Helper: attach the nonce + CSP to a response.
function withNonce(nonce: string, res: NextResponse): NextResponse {
  res.headers.set("Content-Security-Policy", buildCsp(nonce));
  res.headers.set("x-nonce", nonce);
  return res;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const nonce = randomBytes(16).toString("base64");

  // Forward to the app on REQUEST headers: x-nonce (layout reads it for the inline
  // script) AND the full CSP. Next reads the nonce from the request CSP header and
  // auto-nonces the scripts it emits — required under 'strict-dynamic'.
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const pass = () => withNonce(nonce, NextResponse.next({ request: { headers: requestHeaders } }));

  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/internal") ||
    pathname.startsWith("/api/v1") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return pass();
  }

  if (!pathname.startsWith("/api")) {
    const isPublic = isPublicPath(pathname);
    const isAuth = !!req.auth;

    if (!isAuth && !isPublic) {
      const locale = pathname.match(localePrefixRegex)?.[1] ?? routing.defaultLocale;
      return withNonce(nonce, NextResponse.redirect(new URL(`/${locale}/login`, req.url)));
    }
    if (isAuth && isPublicPath(pathname)) {
      const locale = pathname.match(localePrefixRegex)?.[1] ?? routing.defaultLocale;
      return withNonce(nonce, NextResponse.redirect(new URL(`/${locale}`, req.url)));
    }

    // next-intl needs the forwarded request headers too; build it from the same set.
    const intlReq = new Request(req.url, { headers: requestHeaders });
    const intlRes = intlMiddleware(intlReq as never) as NextResponse;
    return withNonce(nonce, intlRes);
  }

  if (!req.auth) {
    return withNonce(nonce, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }
  return pass();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

> The `intlMiddleware(intlReq)` shim passes the nonce-bearing request through
> next-intl. If your next-intl version returns a response you can't re-wrap cleanly,
> set the nonce header on `intlMiddleware`'s result directly (it returns a
> `NextResponse`).

## Change 3 — `app/[locale]/layout.tsx`: nonce the inline script

Read the nonce from the forwarded header and apply it to the `THEME_INIT_SCRIPT`
tag. **Leave `AntdRegistry` exactly as it is** — its SSR `<style>` is allowed by
`style-src 'unsafe-inline'`, so it needs no nonce. Only the inline script changes:

```tsx
import { headers } from "next/headers";
// AntdRegistry import stays unchanged.

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const nonce = (await headers()).get("x-nonce") ?? "";
  // ...messages / direction / theme cookie reads unchanged...

  return (
    <html lang={locale} dir={direction} suppressHydrationWarning>
      <head>
        {/* The inline theme script now carries the per-request nonce. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {/* AntdRegistry, ThemeProvider, etc. all unchanged. */}
        {children}
      </body>
    </html>
  );
}
```

> **The honest part about AntD SSR.** Ant Design v6 uses emotion-based CSS-in-JS
> that emits inline `style="..."` attributes a CSP nonce cannot cover, so
> **`style-src 'unsafe-inline'` stays** — and because it stays, there's no point
> noncing AntD's `<style>` tags either (leave the stock registry alone). Removing
> `'unsafe-inline'` from style-src breaks AntD rendering; revisit at the AntD 7
> migration (ADR-001 trigger). The **script-src** tightening is the real security
> win and is safe — Next nonces its own scripts once it sees the nonce in the
> request CSP header (Change 2).

> The root `app/not-found.tsx` (the context-free Next-16 prerender page — see the
> CLAUDE.md "Known traps") renders its own `<html>`/`<body>` and runs **outside**
> middleware-injected headers at build time, so it has no nonce. It also has no
> inline scripts beyond what Next bootstraps, so the build-time `_not-found` /
> `_global-error` prerender is unaffected — don't add inline scripts there.

## Files to change in a fork

| File                      | Change                                                                           |
| ------------------------- | -------------------------------------------------------------------------------- |
| `next.config.ts`          | Remove the static `Content-Security-Policy` header; update T-05 comment          |
| `middleware.ts`           | Per-request nonce + CSP on **request and response** headers; **Ask-before file** |
| `app/[locale]/layout.tsx` | Read nonce, nonce the inline theme script (registry untouched)                   |
| `SECURITY.md`             | Update §4 + T-05 (script nonce-d; style caveat remains)                          |

> `middleware.ts` is an "Ask before" file. Run `/code-review` then `/ship`.

## Env vars

None.

## How to test

1. `npm run build && npm run dev`. Open any page, check the response headers:
   `Content-Security-Policy` has `script-src 'self' 'nonce-<base64>' 'strict-dynamic'`
   and **no** `'unsafe-inline'` on script-src. Each reload yields a different nonce.
2. **No CSP violations in the console.** Ant Design renders correctly (proves the
   retained style-src `'unsafe-inline'` is right). The theme-flash script runs (its
   `<script>` tag has a matching `nonce`), and Next's own scripts carry the nonce.
3. Toggle dark mode, switch locale (`/ar` RTL) — styling intact, no violations.
4. **Negative check:** temporarily inject `<script>alert(1)</script>` into a page —
   the browser blocks it (no nonce). Remove it.
5. `/uat` for a broader click-through; `/ship` for the gate.

## Rollback

1. Revert `next.config.ts` (restore the static CSP header with `'unsafe-inline'` on
   script-src), `middleware.ts`, and `app/[locale]/layout.tsx` (drop the script nonce).
2. Revert SECURITY.md §4 / T-05.

Pure code change, no DB, instant rollback.

## SECURITY.md rows to update

**§4** — change the CSP caveat to: "script-src is nonce-based (per-request nonce from
`middleware.ts`); `'unsafe-inline'` removed from script-src. `style-src` still allows
`'unsafe-inline'` for Ant Design v6 emotion inline-style attributes (revisit at AntD 7)."

**§11 / T-05** — note "tightened by recipe shared-security/3: nonce CSP on script-src;
style-src caveat documented". **§16 row 3** → done (script side); keep the style note.
