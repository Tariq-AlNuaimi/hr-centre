# Blueprint — React Compiler adoption (P2, C01 core-runtime)

Scope: next.config.ts, package.json, docs/decisions/ADR-048-react-compiler-adoption.md

> First P2 increment after the P0+P1 plan (WS-1..8) landed. Adopts Next.js 16's
> **stable React Compiler** for build-time auto-memoization — the Speed pillar, applied
> uniformly to the client surface with zero hand-written `useMemo`/`useCallback`.
> Decision of record: **ADR-048**. Config-only change (no new route/page/`lib/` file),
> so neither the blueprint gate (ADR-033) nor the build-vs-buy gate (ADR-032) fires —
> this file is the requirements contract regardless, per "Blueprint before building".

## Problem & outcome

The client surface (chrome, auth/settings forms, DataTable, command palette) re-renders
more than it needs to, and the only levers today are hand-written `useMemo`/`useCallback`/
`React.memo` — code that is easy to omit and uneven where present. Next 16 ships a stable
React Compiler that memoizes automatically at build time. **Outcome:** enable it as the
template default so every fork's client components re-render less for free, without adding
memoization code, and without changing the Vercel build shape.

## Users & stories (EARS; worst path mandatory)

- **US1** — As a **fork developer**, I want components auto-memoized at build time, so
  that needless client re-renders are removed without hand-written memoization.
  - **AC-1.1** — WHEN a production build runs THE SYSTEM SHALL apply the React Compiler
    transform (`reactCompiler: true`) and produce a passing build.
  - **AC-1.2 (worst path)** — WHEN a component violates the Rules of React THE SYSTEM
    SHALL bail out on that component and leave it un-optimized rather than change its
    behavior or fail the build (the compiler's documented safe-skip).
- **US2** — As the **template maintainer**, I want the adoption to keep `/ship` green,
  so that no existing behavior regresses.
  - **AC-2.1** — WHEN `/ship` runs THE SYSTEM SHALL pass typecheck, lint, contract +
    component tests, and the production build with the compiler enabled.

## Happy path

`reactCompiler: true` in `next.config.ts` + `babel-plugin-react-compiler` devDep →
`next build` applies auto-memoization → component tests pass unchanged → `/ship` green.

## Worst path / risks

- **Build-time regression** — the Babel pass adds ~35% to build time (measured ~28–30s →
  ~39.5s). Accepted (ADR-048); the Rust port reclaims it at the next Next bump.
- **Memoization-semantic regression** — a component relying on referential _instability_
  could change; mitigated by the compiler's safe bail-out + the component test suite as
  the regression guard. No such reliance is expected in this clean shadcn/Radix codebase.
- **Rust port unavailable** — `experimental.turbopackRustReactCompiler` is not in
  `next@16.2.9` (canary-only); resolved by taking the stable Babel path (ADR-048).

## Architecture sketch

Build-config only: `next.config.ts` gains one stable top-level flag; `package.json` gains
one devDependency. No runtime code, no schema, no route, no `lib/` change. The Vercel
deploy path (ADR-006) is unaffected.

## Tier & gates

Tier: template-level (inherited by all forks). Gates: `/ship` green (incl. the build phase
with the compiler on) + `/code-review` (touches build config) + `senior-code-reviewer`.

## Open questions — resolved

- **Babel vs Rust port?** → Babel (only supported path on pinned `next@16.2.9`; ADR-048).
- **Default-on vs opt-in?** → Default-on **with a per-fork opt-out** (`project.config.json`
  `"reactCompiler": false`): forks inherit the win without action, but the ~35% build-time
  cost has a one-line escape hatch — mirroring the `dockerAck`/`complexityAck` precedent for
  fleet-wide costs (the WS-8 senior-review finding).
- **ESLint compiler rule now?** → Deferred to a tracked follow-on (ADR-048) to keep this
  increment scoped to the compiler itself.
