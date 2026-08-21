# ADR-063 — The production build must not need the network; fonts are vendored

**Status:** Accepted (2026-08-21, Tariq Al-Naaimi — operator identified the dependency and
directed the replacement). Implemented: `app/[locale]/layout.tsx` uses `next/font/local` over
`app/fonts/*.woff2`; verified by a full `npm run build` with the proxy unset and by a complete
Docker image build (exit 0) on the `node:24.19.0-bookworm-slim` base.
**Date:** 2026-08-21
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-001 (locked stack — this constrains HOW a stack element is loaded, it does not
change the stack), ADR-023/ADR-030 (the Docker self-host rail this protects), ADR-035 (self-host
topology), ADR-017 (`/ship`).

## Context

`app/[locale]/layout.tsx` loaded Geist and Geist Mono through `next/font/google`. The comment beside
it said "self-hosted at build time by next/font (no runtime Google request)" — true, and precisely
the half that does not matter for build integrity. `next/font/google` **fetches the font files from
`fonts.googleapis.com` while the build runs**. The runtime is clean; the build is not.

Nothing surfaced this until a Docker image build failed with:

```
next/font: error:
There was an issue establishing a connection while requesting
https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap
```

It would have failed identically in any air-gapped, egress-restricted or offline build — which is
exactly the environment the Docker self-host rail (ADR-023/ADR-030) exists to serve, and the
environment an IT team receiving a `/handoff` is most likely to build in. The failure surfaced in a
sandbox first, but the sandbox was not the cause; it was the first place anyone happened to build
without unrestricted egress.

The near-miss worth recording: the obvious response was to make the _sandbox_ work — inject a CA,
open a proxy path, pass `--network=host`. That would have left the defect in place for every fork.

## Decision drivers

- A fork's production build must succeed on a machine with no egress beyond the package registry.
  The registry is unavoidable (`npm ci` must install); anything else is a defect.
- The reasoning must survive where a code comment does not: forks prune docs, and the next person
  adding a font will reach for `next/font/google` because it is the documented Next.js default.
- No new runtime dependency for what is fundamentally two static assets.

## Decision

1. **Fonts are vendored.** `next/font/local` over two variable `.woff2` files committed at
   `app/fonts/` — one per family, `weight: "100 900"`, which is exactly what the Google import
   requested via `wght@100..900`. Same bytes the browser previously downloaded from Google, now
   served same-origin (which also removes a third-party origin from every page load).
2. **The files are vendored, not depended on.** They come from the official `geist` npm package
   (v1.7.2, `vercel/geist-font`, SIL OFL 1.1). The package itself is **not** a dependency: two
   static assets do not need one, and a dependency would reintroduce a supply-chain edge for
   something that never changes.
3. **`--font-sans` / `--font-mono` are unchanged**, so `brand.config.ts` and
   `tests/contracts/design-tokens.test.ts` still bind the CSS-var contract.
4. **The general rule: the production build makes no network request other than the package
   install.** Adding a build-time fetch — a font, a remote schema, a config pull — needs a
   superseding ADR, not a comment.

## What was verified, and what was not

Swept on 2026-08-21 with the proxy unset (a negative test proving no egress is needed, not a
workaround for a blocked one):

- `npx prisma generate` — exit 0, no network.
- `npm run build` — exit 0, "Compiled successfully".
- Full Docker image build — **exit 0** on `node:24.19.0-bookworm-slim`, both fonts baked in as
  hashed static assets under `.next/static/media/`, image runs.
- `NEXT_TELEMETRY_DISABLED=1` is already set in the Dockerfile, so Next telemetry is not an egress
  path either.
- No `images.remotePatterns`; the only `fetch()` under `app/` is a client-side form handler.

**One conditional egress remains, deliberately:** Sentry source-map upload, gated on
`SENTRY_AUTH_TOKEN`. It is disabled when the token is absent (`sourcemaps.disable: !hasSentryAuth`)
and the Dockerfile declares no `ARG`/`ENV` for it, so **the self-host build cannot reach it**. It is
a Vercel/CI path by construction. If a fork ever forwards that token into a Docker build, it takes
on a build-time network dependency knowingly.

**Not gated.** The operator's call was to sweep, not to add a no-network build gate. So this ADR
records a verified property, not an enforced one: a future change _could_ reintroduce a build-time
fetch and nothing would fail. If that happens twice, gate it.

## Consequences

- The self-host and air-gapped rails build without egress; the `/handoff` package is buildable by a
  receiving team behind a corporate proxy.
- ~138 KB of binary assets are committed. Acceptable: they replace bytes the browser downloaded
  anyway, they never change, and the alternative is a dependency or a network dependency.
- Swapping fonts is now a two-step change — replace the files in `app/fonts/` **and** update
  `brand.config.ts` — instead of editing one import. That friction is the point.
- Anyone reintroducing `next/font/google` reintroduces the defect. This ADR is the only thing that
  says so once the code comment is gone.
