# ADR-048 — React Compiler adoption (auto-memoization)

**Status:** Accepted (enterprise pivot, P2 increment, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Supersedes / amends:** None. This is **additive within the ADR-001 locked stack** —
React 19 is already pinned; the React Compiler is a build-time transform layered on
the existing React/Next.js 16 pins, not a stack swap. No superseding ADR of ADR-001 is
required (contrast ADR-046, which changed the Node and zod major lines).

## Context

The v2 enterprise benchmark flagged React Compiler adoption as a P2 item
(`docs/research/v2/enterprise-benchmark-v2.html`, C01 core-runtime). The compiler,
**stable in Next.js 16**, automatically memoizes components and hook values at build
time — the effect of hand-written `useMemo`/`useCallback`/`React.memo` applied
uniformly, without the code. The benefit is **client-runtime responsiveness** — the
client surface (chrome, forms, interactive tables, command palette) re-renders less
without any per-component memoization work, and new fork code inherits it for free.

Note the pillar framing precisely: the **Speed pillar** as defined in
`docs/uat-rubric.md` is server-side ("RSC reads, no needless round-trips, debounced
inputs, bounded payloads") — client re-render count is not in that definition, so this
is **not** a Speed-pillar change. It is a **High-Quality / UX-perf** improvement
(smoother interaction under load), and it is behaviorally invisible on a compliant
codebase (the compiler changes memoization, not output). That modest, hard-to-observe
upside against a concrete build-time cost (below) is exactly why the decision is
default-on-**with-an-opt-out**, not unconditional.

Two integration paths exist on Next 16:

1. **Stable Babel transform** — `reactCompiler: true` + `babel-plugin-react-compiler`
   (a build-time devDep). Supported/stable, but the Babel pass adds build time.
2. **Experimental Rust port** — `experimental.turbopackRustReactCompiler: true`, native
   in Turbopack, no Babel dep, much faster. **Not available on the pinned `next@16.2.9`**
   — the option is absent from that release's `ExperimentalConfig` type (canary-only),
   so enabling it fails typecheck.

## Decision

**Enable the React Compiler via the stable Babel path as the template default, gated by
a per-fork opt-out.**

- Install `babel-plugin-react-compiler` as a **devDependency** (build-time only; it does
  not ship to the client, so the Ask-before ">50 KB _runtime_ dep" rule does not apply).
- `next.config.ts` sets `reactCompiler: reactCompilerEnabled()` — a helper that reads
  `project.config.json` and returns `true` unless the fork sets `"reactCompiler": false`.
  So the default is ON (every fork inherits the win), but the ~35% build-time cost has a
  **one-line opt-out** for a fork that doesn't want it — mirroring the config-driven
  `locales`/`tier` levers and the `dockerAck`/`complexityAck` opt-out precedent this
  template uses for every other fleet-wide-cost decision (the gap the WS-8 review flagged).
  `reactCompiler` is a stable top-level `NextConfig` option in Next 16 (no longer under
  `experimental`).
- The Vercel build path is unchanged in shape (same `next build`); only the transform is
  added.

**Build-vs-adopt:** this is an _adopt_ decision, not a build — the alternative to the
official compiler is hand-writing `useMemo`/`useCallback` across the client surface
(more code, uneven coverage, exactly the manual memoization the compiler removes) or
doing nothing. The first-party React/Next compiler is the correct buy. No new `lib/`
capability file is introduced, so the build-vs-buy gate (ADR-032) does not fire; this
paragraph is the recorded reasoning.

## Consequences

- **Cost — build time.** The Babel pass adds **~35%** to a warm production build
  (measured: ~28–30s → ~39.5s on this repo). This lands on every `/ship` build phase and
  every CI/Vercel build. Accepted as the price of the runtime win; the fast Rust port
  removes it once the template's pinned Next carries the stable option.
- **Runtime.** Client components re-render less; no behavior change is expected because
  the compiler **bails out safely** on any component that violates the Rules of React
  (it optimizes what it can prove safe and skips the rest). The existing component test
  suite (`tests/components/*`) is the regression guard for the optimized render paths.
- **ESLint visibility — already present, at `warn`.** The compiler's Rules-of-React
  diagnostic (`react-hooks/incompatible-library` and siblings) is **already active**
  today via `eslint-config-next`'s bundled `eslint-plugin-react-hooks@7.1.1` — no new
  plugin or wiring is needed (proof: `components/shared/DataTable.tsx` already carries a
  justified `eslint-disable-next-line react-hooks/incompatible-library` for TanStack
  Table's `useReactTable`). The real gap is that it fires at `warn`, and `/ship`'s lint
  phase does not fail on warnings, so a newly-added component the compiler silently skips
  produces no `/ship`-visible signal. **Follow-on (tracked, not in this increment):**
  promote that rule to `error` (or add `--max-warnings 0` to the lint phase) so a skipped
  component blocks — a one-line change, deferred only to keep this increment scoped.

## Revisit trigger

At the next pinned-Next bump: if the release carries a stable
`turbopackRustReactCompiler` (or Next makes the Rust port the default), switch to it and
drop the `babel-plugin-react-compiler` devDep to reclaim the ~35% build-time cost.
