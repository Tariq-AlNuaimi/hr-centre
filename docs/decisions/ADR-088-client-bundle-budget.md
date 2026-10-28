# ADR-088 — Client bundle: Sentry on demand, and a budget sized for five modules

**Status:** Accepted — the operator approved the 1.8 MB budget on 2026-10-28 (findings register)
**Date:** 2026-10-27
**Decision owner:** Tariq Al-Naaimi (operator)
**Reviewers:** Tariq Al-Naaimi (operator), 2026-10-28

## Context

`size-limit` (ship:full) measures the gzip size of ALL emitted client chunks
(`.next/static/chunks/**/*.js`) against a 1.2 MB budget inherited from the
template. QA (2026-10-27) measured 1.72 MB. The gate only runs in the full loop,
so the overrun went unnoticed while HR Centre absorbed four apps (Performance,
JML, HR tickets, Hiring).

Ranking the chunks showed:

| Contributor                                             | gzip    | Note                                                                             |
| ------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `@sentry/nextjs` browser SDK (+ replay)                 | ~158 kB | shipped to every browser although production has **no** `NEXT_PUBLIC_SENTRY_DSN` |
| Sentry route manifest (`_sentryRouteManifest`)          | ~73 kB  | injected by `withSentryConfig`; only read by the SDK                             |
| recharts                                                | ~108 kB | real use: PMS, JML and Hiring reports                                            |
| Next/React runtime + polyfills                          | ~120 kB | framework                                                                        |
| zod (client forms), Radix, `@vercel/blob` client upload | ~95 kB  | real use                                                                         |
| application code, ~165 route chunks                     | rest    | five modules' screens                                                            |

No server-only library (mammoth, unpdf, docxtemplater, exceljs, pdf libraries)
leaks into the client. Because the metric is the SUM of all chunks, dynamic
imports and code-splitting do not lower it; only removing code from the client
does.

## Decision

1. **Sentry is loaded on demand, and only with a DSN.** `instrumentation-client.ts`
   and the two error boundaries `import("@sentry/nextjs")` lazily, behind
   `process.env.NEXT_PUBLIC_SENTRY_DSN`. `next.config.ts` inlines that variable as
   `""` when unset, so the branch is statically dead and the SDK is not emitted;
   `routeManifestInjection` is off without a client DSN. Result: −~230 kB gzip
   (1.83 MB → 1.66 MB on the current main).
2. **The budget becomes 1.8 MB** (≈ 1.66 MB measured + ~140 kB headroom for the
   UX P1 work in flight). Not silently: this ADR records why, and the register
   asks the operator to confirm or to set a different number.

## Consequences

- With a DSN configured, browser errors in the first moments before the Sentry
  chunk arrives are not captured, and route names are not parameterised. Server
  Sentry is unchanged.
- The sum-of-chunks metric will keep growing with every screen. A per-route
  first-load budget would measure what users actually download; switching the
  metric is left to the operator (it changes the template's gate).

## Considered options

- **Keep 1.2 MB and wave off** — leaves `ship:full` permanently red, which trains
  people to ignore it.
- **Drop Sentry entirely** — loses the observability stack ADR-002 chose; lazy
  loading keeps it at zero cost while unconfigured.
- **Dynamic-import recharts** — no effect on a sum-of-chunks budget.
