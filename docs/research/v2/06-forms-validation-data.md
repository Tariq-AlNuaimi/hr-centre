# C06 — Forms, validation, tables & data-fetching

> Enterprise Benchmark v2 (exhaustive 4-lens top-10). Scored against the fixed stack in `METHODOLOGY.md`: Next.js 16.2.9 (App Router, RSC, React 19.2), Prisma 7, Tailwind v4 + shadcn/Radix, **zod at every API boundary + via `@hookform/resolvers`**. As-of research date: **2026-07-11**. Star/version/license figures are point-in-time — verify at adoption.
>
> Lens tags: **BT** = battle-tested · **HS** = highest-star/most-popular · **ENT** = enterprise-grade · **OSS** = best pure open-source.

Current C06 dependencies:

| Dep | Version | Role |
|-----|---------|------|
| `zod` | ^3.25.76 | Schema validation at every API boundary + form resolver |
| `react-hook-form` | ^7.80.0 | Client form state |
| `@hookform/resolvers` | ^5.4.0 | Bridges zod (and Standard Schema) into RHF |
| `@tanstack/react-table` | ^8.21.3 | Headless table primitive |
| `@tanstack/react-query` | ^5.101.2 | Client async-state cache |

---

### zod@3 (validation)

**One line:** TypeScript-first schema validation used at every API boundary and via `@hookform/resolvers`; we're on **zod ^3.25.76** — the question is zod-4 upgrade vs. migrate to a smaller/faster library.

**4-lens top-10**

| # | Candidate | Lens | Stars (2026-07) | License | Maturity / first release | Why it ranks |
|---|-----------|------|-----------------|---------|--------------------------|--------------|
| 1 | **zod** (v3 + v4/zod-mini) | HS BT ENT | ~42.5k | MIT | 2020; **v4 stable 19 May 2025**, now 4.1.x | De-facto standard, ~15M+ weekly dl; v4 is 7–14× faster + ~57% smaller core than v3; Standard Schema conformant |
| 2 | **Valibot** | OSS | ~8.6k | MIT | 2023; **v1.0 early 2025** | Modular/tree-shakable; ~1.37 kB gz login schema (~90% smaller than zod std); Standard Schema co-author |
| 3 | **ArkType** | (perf) OSS | ~7.7k | MIT | 2022; **v2.0 GA Jan 2025** | Fastest runtime (~3–4× zod/valibot) via TS-syntax string DSL; but ~40 kB fixed bundle |
| 4 | **Yup** | BT | ~23k | MIT | 2017 | Mature, form-centric (Formik heritage); weaker TS inference; losing ground |
| 5 | **TypeBox** | ENT | ~5.5k | MIT | 2021 | JSON-Schema-native (Ajv-compatible); compiled validators ~6M ops/s; ideal for OpenAPI/JSON-Schema |
| 6 | **Effect Schema** (`effect/Schema`) | ENT | ~9k (effect monorepo) | MIT | standalone `@effect/schema` **deprecated** → folded into `effect` core 2024 | Powerful inside the Effect ecosystem; heavy buy-in otherwise; not a standalone pick |
| 7 | **class-validator** | BT | ~11k | MIT | 2016 | Decorator-based; NestJS default; weaker pure-TS inference |
| 8 | **Superstruct** | OSS | ~7k | MIT | 2018 | Small, composable, functional; stable but low activity |
| 9 | **Joi** | BT | ~21k | BSD-3-Clause | 2012 | Node validation workhorse, still actively released (v18.x, 2025) — but runtime-first, **no TS inference** → wrong tool for a TS boundary |
| 10 | **io-ts** | (legacy) | ~6.7k | MIT | 2017 | fp-ts codecs; **effectively unmaintained** (author moved to Effect) |

Honorable mention: **runtypes** (~3.4k, MIT) — superseded by zod/valibot.

**Bundle & runtime numbers (minzipped, real login-form schema):** zod full ~15–18 kB · **zod-mini ~1.88–3.9 kB** · **Valibot ~1.37 kB** · ArkType ~40 kB (poor tree-shaking). Runtime ops/s (5-field object): ArkType ~8M > TypeBox(compiled) ~6M > Valibot ~4M > **zod v4 ~2M** (zod v3 much slower). zod v4 is a **same-package** upgrade (`zod/v4`), not a new dependency.

**Standard Schema:** the ~60-line shared interface co-authored by the zod/valibot/arktype maintainers. zod v4, Valibot, ArkType, and TypeBox all conform; **`@hookform/resolvers` supports `standardSchemaResolver`** — so the form layer is no longer zod-locked and a validator swap needs no RHF rewiring.

**Head-to-head:** zod 4 closed the two historic reasons to leave — it's now 7–14× faster than v3 and ~2.3× smaller, while keeping the largest ecosystem and most familiar API. Valibot still wins raw *client* bundle (~1.37 kB vs ~15 kB), but that advantage only materializes for validation code shipped to the browser — server/RSC validation never pays it. ArkType wins raw throughput (~3–4×) but carries a ~40 kB fixed bundle and an unconventional string-DSL authoring model. All three implement Standard Schema, so the old ecosystem lock-in is gone; the choice is now DX + bundle-locus + migration cost.

**Current-events catches:** `io-ts` unmaintained (author → Effect); standalone `@effect/schema` **deprecated** (now `effect/Schema`); `Joi` is *actively* maintained (only the old `@hapi/joi` is dead) but has no TS inference. No license/security incidents for zod/valibot/arktype (all MIT).

**Recommendation:** **KEEP+HARDEN — upgrade zod v3 → v4.** Validation here is overwhelmingly *server-side* (API routes, RSC, service boundary), so Valibot's client-bundle win barely applies; a migration would rewrite every schema for no security/correctness gain. zod 4 is a same-package bump that dodges the CLAUDE.md ">50 KB dep / ADR" gate, fixes the real pain (7–14× parse speed + much lower `tsc` cost — relevant to the `/ship` typecheck gate), and Standard Schema conformance future-proofs a *local* Valibot adoption later if a client-bundle-sensitive surface emerges. Action: bump `^3.25.76 → ^4.x`, run the v4 migration notes (error-map / `.default` / `.optional` semantics), keep `@hookform/resolvers`. **Fit 5/5.** ADR impact: minor ADR (or note under ADR-001) recording the v3→v4 bump.

---

### react-hook-form (+ @hookform/resolvers)

**One line:** Client form-state library (uncontrolled inputs) bridged to zod via resolvers; we're on **RHF ^7.80.0 + @hookform/resolvers ^5.4.0**.

**4-lens top-10**

| # | Candidate | Lens | Stars (2026-07) | License | Maturity / first release | Weekly dl | Why it ranks |
|---|-----------|------|-----------------|---------|--------------------------|-----------|--------------|
| 1 | **react-hook-form** | BT HS ENT OSS | ~44.8k | MIT | v1 2019; latest **7.81.0** (Jul 2026), **v8 in beta** | ~55.9M | Category default: uncontrolled-input perf, tiny, huge ecosystem, zod via resolvers (Standard Schema supported) |
| 2 | **TanStack Form** | HS BT ENT OSS | ~6.6k | MIT | **v1 stable Mar 2025**, now 1.33.x | ~2.3M | Headless, framework-agnostic, best-in-class TS inference, **native Standard Schema** (pass zod directly, no adapter) |
| 3 | **Conform** (`@conform-to/*`) | ENT HS OSS | ~2.6k | MIT | v1 stable, 1.19.x; 2022 | ~220k | Progressive-enhancement + **Server-Actions**-native; only lib purpose-built for RSC form-without-JS |
| 4 | **Next.js Server Actions (native)** | ENT | n/a (framework) | MIT | Built into Next 16 / React 19.2 | n/a | `useActionState` + `<form action>` gives progressive enhancement free; zod-validate in the action. Baseline, not full client-state |
| 5 | **Formik** | BT (legacy) OSS | ~34.3k | Apache-2.0 | **Maintenance-only** (v3 abandoned 2020; only patch 2.4.9 Nov 2025) | ~4.1M | Huge in legacy code but feature-frozen, controlled-input perf issues, no RSC story — don't start new work on it |
| 6 | **React Final Form** | HS OSS | ~7.4k | MIT | Legacy; stagnant | ~514k | Elegant subscription API but no meaningful 2025–26 releases, no RSC story |
| 7 | **@mantine/form** | HS | (Mantine monorepo) | MIT | Active (Mantine 8.x) | ~686k | Solid but coupled to Mantine UI — irrelevant on a Tailwind/shadcn stack |
| 8 | **Felte** | HS | ~1.1k | MIT | Low activity | ~20k | Niche; Svelte/Solid-first, React secondary |
| — | Radix / native uncontrolled | HS | (Radix ~16k) | MIT | n/a | n/a | Form *controls*, not form *state* — pairs with RHF/native, not a competitor |

**Head-to-head:** For client-driven interactive forms (our actual workload), **RHF and TanStack Form are the two serious picks** and they're close — RHF wins on ecosystem gravity (~24× the downloads, mature `Controller` patterns, v8 already in beta), TanStack Form wins on TS inference and shipping *native* Standard Schema (zod passed directly, no resolver package). **Conform is the specialist**: the only option architected around Server Actions + progressive enhancement — but Next 16's native Server Actions already deliver progressive enhancement for free, narrowing Conform's edge to complex multi-field server-validated POST forms. None is RSC-blocked; all run as `"use client"` islands.

**Current-events catch:** **Formik is effectively feature-frozen** (v3 rewrite abandoned 2020; an ~18-month gap before a dependency-patch 2.4.9 in Nov 2025) — a reason to migrate *off* it elsewhere, never toward it. **RHF v8 is in beta (8.0.0-beta.3)** — pin to 7.x, re-evaluate the `^7.80.0` range against v8 migration notes before bumping.

**Recommendation:** **KEEP.** No trigger to move: RHF is the highest-adoption, healthiest option, MIT, already wired to zod + `@hookform/resolvers` (Standard Schema capable), and fits the RSC boundary cleanly. TanStack Form is the only credible switch and isn't worth a migration now (marginally better inference + adapter-free zod vs. a far smaller ecosystem) — *watch, don't adopt*. Adopt **Conform (or plain native Server Actions)** *tactically* for a specific no-JS/progressive-enhancement server-form requirement, not as a wholesale replacement. **Fit 5/5.** ADR impact: none (add a watch-item note for RHF v8).

---

### @tanstack/react-table (tables & data grids)

**One line:** Headless table primitive (you own the DOM/styling); we're on **@tanstack/react-table ^8.21.3** with Tailwind+shadcn — the question is whether enterprise data-grid needs (virtualization, pivoting, Excel editing, server-side row model) warrant adopting something heavier as an option.

**4-lens top-10**

| # | Candidate | Lens | Stars (2026-07) | License | Maturity / first release | Why it ranks |
|---|-----------|------|-----------------|---------|--------------------------|--------------|
| 1 | **@tanstack/react-table** (headless) | BT OSS | ~28.2k | MIT | v8; project since 2019 | Incumbent. Headless, zero-markup, pairs with TanStack Virtual + shadcn. **No built-in server-side row model** (the enterprise gap) |
| 2 | **AG Grid** (Community + Enterprise) | ENT | ~15.5k | Community MIT / **Enterprise commercial** | Mature; v36 (2026); since 2015 | Enterprise reference: row grouping, pivoting, **server-side row model**, Excel export, master/detail. Official React 19.2 support |
| 3 | **Handsontable** | ENT | ~22k | **Non-OSS: commercial license required for prod** | Mature; v18 (2026); since 2012 | Best Excel-like editing — but **license trap** (see catch) |
| 4 | **react-data-grid** (Adazzle) | HS OSS | ~7.7k | MIT | Long-lived; v7 in prolonged beta | Lightweight, virtualized, editable, MIT — but stuck in perpetual v7-beta (API-stability caveat) |
| 5 | **@tanstack/react-virtual** | HS OSS | ~7.0k | MIT | v3; stable (2026) | Not a grid — the virtualization primitive that closes tanstack-table's large-dataset gap (60fps windowing, headless) |
| 6 | **MUI X DataGrid** (Community + Pro/Premium) | ENT | ~5.8k (mui-x) | Community MIT / **Pro & Premium commercial** | Mature open-core; v9.x (2026); since 2021 | Best if already on MUI; grouping/aggregation/Excel gated behind Premium. Mismatch for Tailwind/shadcn |
| 7 | **Glide Data Grid** | HS OSS | ~5.3k | MIT | **Last release v6.0.3 — Feb 2024 (stale)** | Canvas-rendered, millions of rows, fastest scroll — but **no release in ~2.5 yrs** (maintenance risk) |
| 8 | **Tremor** (tables) | OSS | ~3.5k | Apache-2.0 | Vercel-acquired Jan 2025; fully OSS | Dashboard/KPI Tailwind+Radix components incl. tables — presentation layer, complements not replaces |
| 9 | **Material React Table** (on tanstack-table) | BT ENT | ~1.8k | MIT | v3.2.x — last release Mar 2025 | Batteries-included MUI wrapper over tanstack-table; slowing cadence + hard MUI dep → poor shadcn fit |

**License / feature-gate details:**
- **AG Grid** — Community MIT (sort/filter/basic edit/CSV). **Enterprise (commercial ~$999/dev perpetual, 1 yr updates)** gates row grouping, pivoting, aggregation, **server-side row model**, master/detail, Excel export, integrated charts. React 19.2 supported since v34.3.
- **MUI X DataGrid** — MIT Community; **Pro (~$299/dev/yr)** adds pinning/reorder/tree-data/virtualization; **Premium (~$599/dev/yr)** adds row grouping+aggregation and **Excel export**. Per-developer, application-based; pricing revised Apr 2026.
- **Handsontable** — dropped MIT in 2019; as of v18 (2026) commercial production use requires a **purchased commercial key** (free key is eval/non-commercial only). Do not adopt for a Rihal internal tool without a paid license.
- **Glide Data Grid** — MIT and Glide-branded, but last release Feb 2024 → treat as dormant; adoption = you inherit maintenance.
- **tanstack-table gap** — framework-agnostic, no styling, no data-fetching; scales to large datasets only when paired with `@tanstack/react-virtual`; ships **no server-side row model** — exactly what AG Grid Enterprise / MUI Premium sell.

**Head-to-head:** On **license**, tanstack-table wins outright — pure MIT, headless, zero seat cost — while AG Grid's enterprise features and MUI's grouping/Excel sit behind per-dev commercial licenses. On **enterprise features** the order inverts: AG Grid Enterprise is most complete (server-side row model, pivoting, Excel, master/detail out of the box), MUI Premium covers grouping+aggregation+Excel but is weaker on server-side models, tanstack-table has none built in (you assemble them). On **headless flexibility / stack fit**, tanstack-table is the clear winner for a Tailwind/shadcn/RSC codebase; AG Grid and MUI both impose their own DOM/theme/bundle, and MUI drags in Material UI.

**Current-events catches:** **Handsontable** commercial-for-prod license (confirmed 2026); **Glide Data Grid** dormant since Feb 2024; **Material React Table** cadence slowing (last release Mar 2025).

**Recommendation:** **KEEP + ADD-AS-OPTION (AG Grid via `/scale-up`).** Keep `@tanstack/react-table` as default — right primitive for a headless Tailwind/shadcn/RSC template, MIT, covers the vast majority of internal-tool tables. Close its two real gaps *within the OSS stack*: pair with **`@tanstack/react-virtual`** for large datasets, and implement server-side sort/filter/paginate against bounded Prisma routes (the Scalable pillar already requires bounded queries). **Add AG Grid (Community MIT default, Enterprise as a paid escape hatch) as a `/scale-up` recipe** for genuine enterprise-grid triggers — pivoting, an out-of-the-box server-side row model, spreadsheet-grade Excel export. Explicitly **exclude Handsontable** (license) and **Glide** (dormant); note MUI X only for MUI-committed forks. **Fit 5/5** (tanstack-table) / **3/5** (AG Grid as bolt-on). ADR impact: new `/scale-up` recipe entry + build-vs-buy ledger note for AG Grid.

---

### @tanstack/react-query (data-fetching / async-state)

**One line:** Client async-state cache; we're on **@tanstack/react-query ^5.101.2** — the real question in Next 16 (RSC + Server Actions) is whether we need a client-fetching library at all, or only for specific client-interactivity islands.

**4-lens top-10**

| # | Candidate | Lens | Stars (2026-07) | License | Maturity / first release | Why it ranks |
|---|-----------|------|-----------------|---------|--------------------------|--------------|
| 1 | **@tanstack/react-query** v5 | BT HS ENT OSS | ~50k (monorepo) | MIT | v1 2019; v5 at 5.101.x | Category leader; ~36.7M weekly dl, active cadence, first-class RSC hydration story |
| 2 | **React 19 `use()` + Suspense + RSC** ("no library") | BT ENT | part of React (~237k) | MIT | RSC/React 19 GA Dec 2024 | Server does the initial read; zero client-cache dep for read-once data — the **default** on Next 16 |
| 3 | **Next.js native `fetch` caching** | BT ENT | part of Next.js (~133k) | MIT | App Router GA 2023 | Framework-owned dedupe/revalidate/tags for server reads; no extra dep, no client bundle |
| 4 | **SWR** (Vercel) | BT OSS | ~32.4k | MIT | v1 2019; v2.4.x stable, **v2.5 still beta** | Lean react-query alternative — but cadence slowed (no v3; Vercel steering to RSC/native fetch) |
| 5 | **tRPC** (typed data layer) | HS OSS | ~40.4k | MIT | 2020; v11 stable | End-to-end type-safe RPC that *rides on* react-query's client — complements, doesn't replace a cache |
| 6 | **Apollo Client** | BT ENT | ~19.7k | MIT | 2016 | GraphQL-only normalized cache. Off-path for a REST/Server-Actions repo |
| 7 | **Relay** | BT ENT | ~18.9k | MIT | 2015 (Meta) | GraphQL-only, compiler-driven, steep ramp; Meta-scale only. Off-path |
| 8 | **RTK Query** (Redux Toolkit) | BT ENT OSS | ~11.2k (RTK repo) | MIT | 2021 | Good if *already* on Redux; otherwise pulls in a store you don't need |
| 9 | **urql** | HS OSS | ~8.9k | MIT | 2019 | Lightweight modular GraphQL client. Off-path (GraphQL-only) |

**Off-path note:** Apollo, urql, Relay are **GraphQL-specific** — non-starters for a REST + Server-Actions repo unless GraphQL is deliberately adopted (an ADR-001 stack change).

**Head-to-head:** On Next 16 App Router, **Server Components + native `fetch` caching are the default read path** — TanStack itself advises "avoid bringing in React Query until you actually need it" and to "treat Server Components as a place to prefetch data, nothing more." That collapses the *initial-read* justification for both react-query and SWR. Where a client cache still earns its place is **interactivity islands** — optimistic updates, polling/refetch-on-focus, infinite scroll, cross-route invalidation, offline — and there **react-query is materially ahead of SWR**: richer mutation/invalidation model, a documented streaming-hydration path (`dehydrate()`/`HydrationBoundary`, `@tanstack/react-query-next-experimental`), and a faster cadence. **SWR is stable but coasting** (stuck on v2.x since 2022, v2.5 still beta, Vercel's energy shifting to RSC). For **mutations**, React 19 **Server Actions + `useActionState`** now own UI-local form/save flows and compete directly with react-query mutations.

**Current-events catch:** **SWR cadence has visibly slowed** — v2.5 still in beta, its headline feature literally "rsc fetches and prefill swr cache," signalling Vercel steering users toward native RSC/fetch rather than growing SWR.

**Recommendation:** **KEEP — scoped to client-interactivity islands.** Keep `@tanstack/react-query ^5.101.2` (healthiest, most capable in its category), but **do not** use it as the default read layer. **Reach for it** when a client component needs optimistic updates, focus/interval **polling**, **infinite scroll/pagination** islands, cross-component **cache invalidation** after a mutation, dependent/parallel client queries, or offline/retry — wired via the streaming-hydration pattern (`dehydrate` in an RSC → `HydrationBoundary` → `useQuery`/`useSuspenseQuery` in the client child). **Reach for RSC + native `fetch`** (no library) for the common case: read-once, server-rendered dashboards/tables/detail pages/initial loads. **For mutations, prefer Server Actions + `useActionState`** and call `queryClient.invalidateQueries()` only to refresh react-query-held client cache the write touched. Keeps react-query a bounded tool, not a data-architecture spine — consistent with the Speed (no needless client round-trips) and Maintainable pillars. **Fit 5/5** (as scoped tool). ADR impact: a convention/ADR codifying "RSC+fetch for reads, Server Actions for mutations, react-query only for interactivity islands."

---

## Category verdict table

| Item | Current | Recommendation | Net-new deps to add | ADR impact | Priority |
|------|---------|----------------|---------------------|-----------|----------|
| **zod** | zod ^3.25.76 | **KEEP+HARDEN** — upgrade v3 → v4 (same package; 7–14× faster, smaller `tsc` cost) | none (same-package bump) | Minor ADR / ADR-001 note recording v4 bump | **P1** |
| **react-hook-form** | RHF ^7.80.0 + resolvers ^5.4.0 | **KEEP** — healthiest option; TanStack Form watch-only; Conform tactical for no-JS server forms | none | none (RHF-v8 watch note) | **P2** |
| **@tanstack/react-table** | ^8.21.3 | **KEEP + ADD-AS-OPTION** — pair with `@tanstack/react-virtual`; add AG Grid as `/scale-up` escape hatch for pivot/server-row-model/Excel | `@tanstack/react-virtual` (OSS); AG Grid only on trigger | New `/scale-up` recipe + build-vs-buy ledger entry (AG Grid) | **P1** (virtual) / P2 (AG Grid recipe) |
| **@tanstack/react-query** | ^5.101.2 | **KEEP** — scope to client-interactivity islands; RSC+fetch for reads, Server Actions for mutations | none | Convention/ADR: reads=RSC, mutations=Server Actions, RQ=islands | **P1** (guidance) |

**Excluded / avoid:** Handsontable (commercial-for-prod license), Glide Data Grid (dormant since Feb 2024), Formik (feature-frozen), io-ts (unmaintained), Apollo/urql/Relay (GraphQL-only, off-path). SWR is a viable-but-coasting alternative to react-query — no reason to switch to it.

---

## Sources

**zod / validation**
1. Zod v4 release notes (stable, perf, zod-mini 1.88 kB) — https://zod.dev/v4
2. Zod v4 GA + Zod Mini (InfoQ) — https://www.infoq.com/news/2025/08/zod-v4-available/
3. Valibot vs Zod v4 / bundle & runtime benchmarks (PkgPulse) — https://www.pkgpulse.com/guides/valibot-vs-zod-v4-2026
4. GitHub topics (star counts) — https://github.com/topics/zod · /valibot · /arktype
5. npm trends — https://npmtrends.com/@sinclair/typebox-vs-arktype-vs-valibot-vs-zod
6. Standard Schema spec — https://standardschema.dev
7. `@hookform/resolvers` (Standard Schema support) — https://github.com/react-hook-form/resolvers
8. Zod releases (4.0 May 19 2025; 4.1.x) — https://github.com/colinhacks/zod/releases
9. Valibot v1.0 — https://valibot.dev/blog/valibot-v1-the-1-kb-schema-library/
10. ArkType 2.0 GA (Jan 2025) — https://arktype.io/docs/blog/2.0

**react-hook-form / forms**
11. react-hook-form — npm — https://www.npmjs.com/package/react-hook-form
12. react-hook-form releases (v8 beta / 7.81.0) — https://github.com/react-hook-form/react-hook-form/releases
13. Announcing TanStack Form v1 — https://tanstack.com/blog/announcing-tanstack-form-v1
14. TanStack Form SSR docs — https://tanstack.com/form/latest/docs/framework/react/guides/ssr
15. Conform (edmundhung/conform) — https://github.com/edmundhung/conform
16. Formik releases (2.4.9 Nov 2025; v3-next stalled 2020) — https://github.com/jaredpalmer/formik/releases
17. Next.js Server Actions guide (2026) — https://makerkit.dev/blog/tutorials/nextjs-server-actions

**tanstack-table / data grids**
18. TanStack Table — https://github.com/TanStack/table
19. AG Grid — https://github.com/ag-grid/ag-grid · pricing https://www.ag-grid.com/license-pricing/ · React 19 https://www.ag-grid.com/react-data-grid/compatibility/
20. Handsontable license (2026) — https://handsontable.com/docs/javascript-data-grid/software-license/
21. react-data-grid (Adazzle) — https://github.com/adazzle/react-data-grid
22. TanStack Virtual — https://github.com/TanStack/virtual
23. MUI X — https://github.com/mui/mui-x · pricing https://mui.com/pricing/
24. Glide Data Grid — https://github.com/glideapps/glide-data-grid
25. Tremor — https://github.com/tremorlabs/tremor · https://vercel.com/blog/vercel-acquires-tremor
26. Material React Table — https://github.com/KevinVandy/material-react-table

**react-query / data-fetching**
27. TanStack Query releases & repo — https://github.com/TanStack/query/releases
28. @tanstack/react-query npm (v5.101.2; ~36.7M weekly dl) — https://www.npmjs.com/package/@tanstack/react-query
29. vercel/swr releases (v2.4.x stable; v2.5.0-beta) — https://github.com/vercel/swr/releases
30. TanStack "Advanced Server Rendering" (dehydrate/hydrate/streaming) — https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr
31. TanStack SSR guidance ("avoid until you need it") — https://tanstack.com/query/latest/docs/framework/react/guides/ssr
32. trpc/trpc — https://github.com/trpc/trpc
33. React 19 Server Components & Actions guide — https://react.dev
