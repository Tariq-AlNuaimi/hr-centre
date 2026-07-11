# C01 — Core framework, runtime & build

> Exhaustive 4-lens top-10 benchmark. Ground truth = `package.json` (not CLAUDE.md).
> Stack under test: **Next.js 16.2.9** (App Router, RSC, Node-runtime middleware) · **React 19.2** · **TypeScript 5** · **Node 22** · build `output:"standalone"` gated on `DOCKER_BUILD=1` (Turbopack default in Next 16).
> Pivot constraints honored: enterprise-only, **deploy-per-tenant** (no in-app multi-tenancy), **Docker-first / self-hosted** default (Vercel optional), compose-now/k8s-later, Claude-first AI.
> All star counts verified via GitHub API **as-of 2026-07-11**. Lens tags: `BT`=battle-tested · `HS`=highest-star · `ENT`=enterprise-grade · `OSS`=best pure OSS.

---

### Next.js (our meta-framework)

**One line:** RSC-first React meta-framework (App Router, server actions, Node-runtime middleware); **our current choice, pinned `next@16.2.9`** (latest line is 16.3.x).

| # | Candidate | Lens | Stars (2026-07-11) | License | Maturity / 1st release | One-line why-it-ranks |
|---|-----------|------|--------------------|---------|------------------------|-----------------------|
| 1 | **Next.js 16** (ours) | BT·HS·ENT·OSS | 140,771 | MIT | 2016; 16.x stable, Turbopack default | RSC-first, largest ecosystem, Vercel+self-host, most enterprise reference deployments |
| 2 | React Router 7/8 (ex-Remix) | BT·OSS | 56,487 | MIT | RR 2014; framework-mode = Remix successor; **v8 shipped 2026** | Vite-native SSR, loaders/actions, no vendor pull; RR6+Remix2 now EOL |
| 3 | TanStack Start | OSS | 14,778 (TanStack/router) | MIT | **v1 stable Mar 2026** | Type-safe end-to-end, server functions, Vite; client-first (opt-in SSR) |
| 4 | Nuxt 4 | BT·HS·OSS | 60,662 | MIT | 2016 | Vue equivalent of Next; irrelevant to a React shop except as reference |
| 5 | Astro 5 | HS·OSS | 60,900 | MIT | 2021 | Islands/content-first; great for marketing sites, weak for app-heavy RSC |
| 6 | SvelteKit | OSS | 20,655 | MIT | 2020 | Compiler-based, tiny runtime; non-React, full rewrite cost |
| 7 | Redwood **SDK** (was RedwoodJS) | — | see note | MIT | **RedwoodJS→"Redwood GraphQL" wound down 2025; SDK is Cloudflare-only** | RSC on Cloudflare Workers; lock-in + immature — **current-events catch** |
| 8 | Waku | OSS | 6,363 | MIT | 2023 | Minimal RSC framework by Jotai author; too small for enterprise |
| 9 | Vike (ex-vite-plugin-ssr) | OSS | ~9k | MIT | 2021 | Framework-agnostic SSR on Vite; niche, DIY-heavy |
| 10 | Modern.js (ByteDance) | ENT | ~9k | MIT | 2022 | Rspack-based, used internally at ByteDance; thin Western community |

**Head-to-head.** The only serious enterprise contenders for a React shop are **Next 16**, **React Router 7/8**, and **TanStack Start**. Next wins on ecosystem depth, RSC maturity, hiring pool, and self-host story (`output:"standalone"` → small Docker image, our exact pivot need) — its one liability is Vercel gravity, which the standalone/Node-runtime path already neutralizes. React Router 8 is the credible escape hatch: Vite-native, zero vendor pull, loaders/actions instead of RSC — but it means abandoning the RSC model the whole template is built on, and Remix-the-brand has effectively dissolved into it. TanStack Start is the type-safety darling and now v1-stable, but it is *client-first* (SSR is opt-in per route), so it inverts our RSC-default security posture and is <1 year GA — too green to bet an enterprise factory on. Astro/SvelteKit/Nuxt are wrong-tool or wrong-language for an app-heavy React platform.

**Recommendation: KEEP+HARDEN.** Stay on Next 16; **bump the pin off `16.2.9` to the current 16.3.x** to pick up the persistent Turbopack build cache and security patches (the CLAUDE.md pin note is about Next-16 regressions #85668/#86178, satisfied by any 16.x with the context-free root file). Keep the Node-runtime middleware + `output:"standalone"` self-host path as the primary, Vercel as optional. **Fit 5/5.** ADR impact: minor — amend ADR-001 to record the 16.3 floor; no framework change.

---

### React / react-dom

**One line:** The UI library itself; **our current choice `react@^19.2.5` / `react-dom` (latest 19.2.7)**, RSC + Actions + `use()` era.

| # | Candidate | Lens | Stars (2026-07-11) | License | Maturity | One-line why-it-ranks (enterprise-React framing) |
|---|-----------|------|--------------------|---------|----------|--------------------------------------------------|
| 1 | **React 19** (ours) | BT·HS·ENT·OSS | 246,000 | MIT | 2013; 19.2.7 (Jun 2026) | Default enterprise UI runtime — RSC, hiring pool, vendor/component ecosystem, LTS-grade stability |
| 2 | Vue 3 | BT·HS·OSS | 53,944 (core) | MIT | 2014 | Mature, great DX; different mental model, smaller enterprise-hire pool in US |
| 3 | Svelte 5 (runes) | HS·OSS | 87,564 | MIT | 2016 | Compiler, tiny output, no vDOM; ecosystem thinner for enterprise widgets |
| 4 | SolidJS | OSS | 35,713 | MIT | 2018 | Fine-grained reactivity, fastest; JSX-like but not React — component libs sparse |
| 5 | Preact | OSS | 38,750 | MIT | 2015 | 3 kB React-API-compatible; drop-in for size-critical, not for RSC/enterprise breadth |
| 6 | Qwik | OSS | 22,037 | MIT | 2021 | Resumability/no-hydration; novel but small ecosystem, adoption stalled |
| 7 | Angular | BT·ENT | ~99k | MIT | 2016 | Batteries-included, strong in regulated enterprises; heavy, non-React |
| 8 | SolidStart | OSS | (Solid) | MIT | 2024 | Solid's meta-framework; too young for enterprise |
| 9 | Lit (web components) | OSS·ENT | ~19k | BSD-3 | 2019 | Standards-based, framework-neutral design systems; not an app framework |
| 10 | Million.js / compilers | — | ~16k | MIT | 2022 | React-perf add-on, not a replacement |

**Head-to-head.** For an enterprise React shop the honest calculus is: React 19 is the *substrate*, and every serious alternative (Vue, Svelte, Solid, Qwik) demands abandoning the React component ecosystem — Radix, shadcn, TanStack Table/Query, react-hook-form — that the rest of this template already depends on. Solid/Qwik/Svelte win micro-benchmarks but lose on hiring, third-party components, and RSC support; React's own React Compiler (built into Next 16) closes much of the perf gap without a rewrite. Preact is the only "swap" that keeps the API, but it lacks first-class RSC support and buys nothing at enterprise scale. There is no defensible reason for a React-committed factory to leave React.

**Recommendation: KEEP.** Track the 19.2.x line; adopt the **React Compiler** (Next 16 has it built-in) as a `/scale-up` perf lever. **Fit 5/5.** ADR impact: none (React is inside the ADR-001 locked stack).

---

### TypeScript

**One line:** Typed superset compiled to JS; **our current choice `typescript@^5`** (`strict`), enforced by `/ship` typecheck.

| # | Candidate / posture | Lens | Stars (2026-07-11) | License | Maturity | One-line why-it-ranks |
|---|---------------------|------|--------------------|---------|----------|-----------------------|
| 1 | **TypeScript 5** (ours) | BT·HS·ENT·OSS | 109,808 | Apache-2.0 | 2012; 5.x mature | The enterprise default; full type-safety, editor tooling, every lib ships `.d.ts` |
| 2 | **TypeScript 7 ("Corsa", Go-native)** | BT·ENT | 25,896 (typescript-go) | Apache-2.0 (MIT for the Go repo) | **GA 2026-07-08; ~10× faster tsc** | Same language, native compiler — 10× typecheck/editor speed, half the memory — **current-events catch** |
| 3 | Plain JS + JSDoc types | OSS | (n/a) | — | mature | No build step, checkJs via tsc; loses generics ergonomics, refactor safety at scale |
| 4 | Flow (Meta) | — | ~22k | MIT | 2014 | Effectively legacy outside Meta; do not adopt |
| 5 | ReScript | OSS | ~7k | MIT | 2020 | Sound types, OCaml-based; tiny ecosystem, interop friction |
| 6 | tsc alternatives (swc/esbuild type-strip) | BT | — | MIT | mature | Fast *transpile* but **no type-checking** — pair with tsc `--noEmit`, don't replace it |

**Head-to-head.** The real 2026 decision is not "TS vs JS" (for an enterprise factory, TS wins on refactor safety, API contracts, and the zod/Prisma type-flow this template relies on — JSDoc-only cannot express the generics in `lib/api-helpers.ts` cleanly). The decision is **TS 5 vs TS 7**: TS 7 is the *same language* rewritten in Go, GA as of 2026-07-08, ~10× faster `tsc` and editor load — a pure win for a large monorepo's `/ship` typecheck and IDE latency, with essentially no syntax migration. Risk is age (weeks-old GA) and a few edge-case API/plugin gaps in the language service.

**Recommendation: KEEP now, plan TS 7 adoption.** Keep `typescript@^5` (really TS 6 in-range per ADR-017) as the committed compiler; **pilot TS 7 in CI as a shadow typecheck** and graduate it once ecosystem plugins (ESLint parser, ts-jest-equivalents, editor) confirm parity — a quarterly-stack-refresh ADR, not an in-range bump. **Fit 5/5.** ADR impact: new ADR "adopt TypeScript 7 native compiler" (P1) + note the `typescript@^5` range now spans 5→6→7.

---

### Node 22 runtime

**One line:** JS runtime the app + middleware + build run on; **our current choice Node 22** (`@types/node@^22`).

| # | Candidate | Lens | Stars (2026-07-11) | License | Maturity / status | One-line why-it-ranks |
|---|-----------|------|--------------------|---------|-------------------|-----------------------|
| 1 | **Node 24 (Active LTS)** | BT·HS·ENT·OSS | 118,274 (nodejs/node) | MIT | Active LTS, EOL 2028-04 | The 2026 enterprise default; full Next 16 support, longest runway |
| 2 | **Node 22 (ours, Maintenance LTS)** | BT·ENT | ↑ | MIT | **Maintenance LTS, EOL 2027-04** | Rock-solid but security-fixes-only after 2026-10; on the clock |
| 3 | Bun 1.2+ | HS·OSS | 94,346 | MIT | 2021; 1.2 prod-usable | ~1.7× Node throughput, built-in bundler/test/pm; Next "mostly works", not Vercel-blessed for prod |
| 4 | Deno 2 | HS·OSS | 107,731 | MIT | 2018; v2 npm-compatible | Secure-by-default, native TS; Next compat improved but not first-class |
| 5 | Node 26 (upcoming LTS) | BT | ↑ | MIT | LTS Oct 2026 | Next LTS line; evaluate at next stack-refresh |

**Head-to-head.** Node stays the enterprise substrate: it runs ~85% of enterprise traffic, has predictable LTS, and is the runtime Vercel/Next test against first. **Node 22 is now Maintenance LTS** (features frozen, security-only after Oct 2026, EOL Apr 2027) — for a factory shipping enterprise tenants that's a liability, so the move is **Node 24 (Active LTS, EOL 2028)**, a drop-in bump. Bun is genuinely faster and a lovely all-in-one, and Next apps "mostly just work," but it is not a supported Next production runtime and its Docker/enterprise-ops story is younger — keep it as a *dev-time speed* option, not the prod runtime. Deno 2 closed the npm gap but Next remains a second-class citizen. Neither displaces Node for a compliance-minded, Docker-first deployment.

**Recommendation: REPLACE → Node 24 LTS.** Bump the base image + `@types/node` to 24 (Active LTS through 2028); pin the Docker base to a digest. Optionally allow **Bun as the dev/test runner** via `/scale-up` (faster local loop) while prod stays Node. **Fit 4/5** (only because 22 is aging). ADR impact: amend ADR-001/ADR-030 to name Node 24 as the runtime floor (P0 — cheap, removes the 2027 EOL cliff).

---

### Build / bundler (Turbopack · webpack · Vite/Rspack) + `output:"standalone"`

**One line:** How the app compiles for dev & prod; **our current setup = Turbopack (Next 16 default, dev+build) + `output:"standalone"` gated on `DOCKER_BUILD=1`** for a small self-host image.

| # | Candidate | Lens | Stars (2026-07-11) | License | Maturity | One-line why-it-ranks |
|---|-----------|------|--------------------|---------|----------|-----------------------|
| 1 | **Turbopack** (ours, via Next) | BT·ENT | (in vercel/next.js) | MIT | **Stable + default dev & build in Next 16; persistent cache in 16.3** | Rust, incremental, first-class in Next; the sanctioned path — zero config for us |
| 2 | webpack | BT·HS·OSS | 65,929 | MIT | 2012; mature | The compatibility fallback; slower, but every loader/plugin exists |
| 3 | Vite (Rolldown-powered) | BT·HS·OSS | 81,980 | MIT | 2020 | The non-Next ecosystem's default; only relevant if we leave Next (RR7/TanStack) |
| 4 | Rspack | OSS·ENT | 12,806 | MIT | 2022 (ByteDance) | Rust, webpack-API-compatible; drop-in webpack speedup, powers Next-alt Modern.js |
| 5 | esbuild | BT·OSS | ~40k | MIT | 2020 | Ultra-fast transpile/bundle; underpins tsx/others, not a Next build |
| 6 | Rolldown | OSS | ~12k | MIT | 2024 | Rust Rollup successor, now inside Vite; watch, not adopt standalone |

**Head-to-head.** Inside Next 16 the bundler question is essentially **settled**: Turbopack is stable and the default for both `next dev` and `next build`, with a persistent FS build cache landing in 16.3 — we don't choose it, we inherit it, and it materially speeds CI. webpack remains only as the escape hatch for an unported loader. Vite/Rspack matter *only* in the counterfactual where we leave Next (React Router 7 / TanStack Start both build on Vite) — so they're really C01-framework decisions, not bundler decisions. `output:"standalone"` is the correct self-host primitive (traces the minimal `node_modules` into a lean image) and directly serves the Docker-first pivot — keep it, and keep it gated on `DOCKER_BUILD=1` so Vercel builds stay byte-identical (per the CLAUDE.md trap).

**Recommendation: KEEP.** Turbopack default + `output:"standalone"` for the Docker image is exactly right for the pivot. Action: **enable the Turbopack persistent build cache** (16.3) in CI to cut cold-build time; keep webpack available only as a documented fallback. **Fit 5/5.** ADR impact: none (fold the 16.3 build-cache note into the ADR-001 refresh).

---

### Monorepo tooling (Nx · Turborepo · pnpm workspaces)

**One line:** Multi-package build/task orchestration; **NET-NEW — the template is a single-app repo today (no workspace tooling).**

| # | Candidate | Lens | Stars (2026-07-11) | License | Maturity | One-line why-it-ranks |
|---|-----------|------|--------------------|---------|----------|-----------------------|
| 1 | **pnpm workspaces** | BT·HS·OSS | 35,740 | MIT | 2016; mature | Fast, disk-efficient PM with native workspaces + catalogs; the substrate under both tools below |
| 2 | **Turborepo** | BT·HS·ENT·OSS | 30,697 | MIT | 2021 (Vercel), Rust | Lowest-friction task cache for a JS/TS workspace; free remote cache; Vercel-aligned with Next |
| 3 | Nx | BT·HS·ENT | 29,149 | MIT | 2017 (Nrwl) | Full monorepo *platform* — affected-graph, generators, boundaries, `nx release`; for many teams/app-types |
| 4 | Bazel | BT·ENT | ~24k | Apache-2.0 | 2015 (Google) | Hermetic, polyglot, extreme scale; heavy, wrong ergonomics for a JS-only factory |
| 5 | moonrepo (moon) | OSS | ~4k | MIT | 2022 | Rust task runner; promising, smaller community |
| 6 | Lerna | — | ~35k | MIT | 2015 (now Nx-owned) | Legacy publish tool; superseded by Turbo/Nx + Changesets |

**Head-to-head.** The 2026 consensus is unambiguous: **start with pnpm workspaces + Turborepo, graduate to Nx only when coordination becomes the bottleneck** (multiple teams, several app types, architectural boundaries to enforce, CI cost high enough to need affected-graph). But the binding pivot here is **deploy-per-tenant with no in-app multi-tenancy** — each tenant is a *fork/deploy of one app*, not many packages in one repo. That means we do **not** need monorepo tooling for the tenant axis at all. A workspace only earns its keep if the factory grows shared internal packages (e.g. `@rihal/ui`, `@rihal/config`, the ESLint rules, the senior-review tool) consumed across several template-derived apps. Nx's heavier platform (generators, boundaries) is overkill until there are genuinely multiple app types and teams.

**Recommendation: DEFER (adopt-as-option).** No monorepo tool in v1 — a single-app-per-deploy factory doesn't need one. **When** shared packages emerge, adopt **pnpm workspaces + Turborepo** (lowest friction, Vercel/Next-aligned, free remote cache) and pair with the already-present **Changesets** for release; reserve **Nx** for a later "platform" phase if multiple app types + teams materialize. **Fit 3/5** (not needed now, clean path when it is). ADR impact: new DEFER-ADR "monorepo posture: single-app-per-tenant; pnpm+Turborepo when shared packages appear" (P2).

---

## Category verdict table

| Item | Current | Recommendation | Net-new deps to add | ADR impact | Priority |
|------|---------|----------------|---------------------|-----------|----------|
| Meta-framework | Next.js 16.2.9 | **KEEP+HARDEN** — bump pin → 16.3.x | none | Amend ADR-001 (16.3 floor) | **P1** |
| React | react 19.2 | **KEEP** — track 19.2.x, adopt React Compiler | none (compiler in Next 16) | none | P2 |
| TypeScript | typescript ^5 | **KEEP now, plan TS 7** — shadow-typecheck TS 7 in CI | `@typescript/native-preview` → later `typescript@7` | New ADR: adopt TS 7 native compiler | **P1** |
| Runtime | Node 22 (Maint. LTS) | **REPLACE → Node 24 (Active LTS)** | Docker base + `@types/node@24` | Amend ADR-001/030 (Node 24 floor) | **P0** |
| Bundler / build | Turbopack + `standalone` | **KEEP** — enable 16.3 persistent build cache | none | none | P2 |
| Monorepo tooling | none (single app) | **DEFER** — pnpm+Turborepo when shared pkgs appear | (later) `pnpm`, `turbo` | New DEFER-ADR: monorepo posture | P2 |

**Current-events catches (2026):** (1) **TypeScript 7 "Corsa" GA'd 2026-07-08** — same language, Go-native, ~10× faster tsc — our `^5` is now two majors behind. (2) **Node 22 dropped to Maintenance LTS** (security-only after Oct 2026, EOL Apr 2027); **Node 24 is Active LTS**. (3) **RedwoodJS wound down → "Redwood GraphQL" (maintenance) + Cloudflare-only RedwoodSDK**; community fork = CedarJS — do not adopt Redwood. (4) **Remix dissolved into React Router 7/8**; RR6 + Remix2 are **EOL**. (5) **TanStack Start hit v1 stable (Mar 2026)**; **Turbopack is now the stable default for dev *and* build** in Next 16.

---

## Sources

1. Next.js repo (stars 140,771, MIT, pushed 2026-07-11) — GitHub API `vercel/next.js`, 2026-07-11.
2. Next.js 16 — Turbopack stable + default for dev and build — https://nextjs.org/blog/next-16 ; https://progosling.com/en/dev-digest/2026-02/nextjs-16-turbopack-default
3. Turbopack persistent build cache (Next 16.3) — https://nextjs.org/blog/next-16-3-turbopack
4. React repo (246k stars, MIT, latest 19.2.7 Jun 2026) — https://github.com/facebook/react (fetched 2026-07-11).
5. React Router / Remix consolidation, v8 in 2026, RR6+Remix2 EOL — https://remix.run/blog/react-router-v8 ; https://remix.run/blog/react-router-v7
6. TanStack Start v1 stable Mar 2026; router repo 14,778 stars — https://tanstack.com/blog/announcing-tanstack-start-v1 ; GitHub API `TanStack/router` 2026-07-11.
7. TanStack Start vs Next.js 16 (client-first vs RSC-first) — https://www.buildwithmatija.com/blog/tanstack-start-vs-nextjs-16-comparison ; https://makerkit.dev/blog/tutorials/tanstack-start-vs-nextjs
8. Nuxt 60,662 / SvelteKit 20,655 / Astro 60,900 / Waku 6,363 — GitHub API 2026-07-11.
9. RedwoodJS → Redwood GraphQL wind-down; RedwoodSDK (Cloudflare, RSC, no GraphQL); CedarJS fork — https://frontendmasters.com/blog/redwoodsdk/ ; https://rwsdk.com/ ; https://github.com/redwoodjs/graphql
10. TypeScript repo 109,808 stars (Apache-2.0); typescript-go 25,896 — GitHub API 2026-07-11.
11. TypeScript 7 "Corsa" Go-native GA 2026-07-08, ~10× faster (VS Code 77.8s→7.5s) — https://visualstudiomagazine.com/articles/2026/06/22/typescript-7-0-rc-moves-microsofts-go-rewrite-into-the-mainline-compiler.aspx ; https://morello.dev/blog/typescript-7-is-here ; https://github.com/microsoft/typescript-go
12. Node.js repo 118,274 stars, MIT — GitHub API `nodejs/node` 2026-07-11.
13. Node 22 Maintenance LTS (EOL 2027-04) vs Node 24 Active LTS (EOL 2028-04), Node 26 LTS Oct 2026 — https://endoflife.date/nodejs ; https://pocketlantern.dev/briefs/node-22-vs-node-24-after-release-schedule-change-2026
14. Bun 94,346 / Deno 107,731 stars; Bun 1.2 & Deno 2 Next compatibility — GitHub API 2026-07-11 ; https://stacknotice.com/blog/bun-deno-nodejs-comparison-2026
15. Solid 35,713 / Svelte 87,564 / Vue-core 53,944 / Preact 38,750 / Qwik 22,037 — GitHub API 2026-07-11.
16. webpack 65,929 / Vite 81,980 / Rspack 12,806 / pnpm 35,740 / Nx 29,149 / Turborepo 30,697 — GitHub API 2026-07-11.
17. Turborepo vs Nx vs pnpm 2026 (start Turbo, graduate to Nx) — https://www.pkgpulse.com/guides/turborepo-vs-nx-monorepo-2026 ; https://stevekinney.com/courses/enterprise-ui/turborepo-versus-nx
