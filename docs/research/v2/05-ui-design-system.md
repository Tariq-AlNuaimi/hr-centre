# C05 — UI Framework & Design System (Enterprise Benchmark v2)

> Scope: the whole UI stack after the migration **off Ant Design → Tailwind v4 + Radix + shadcn/ui**.
> Ground truth = `package.json` (Next 16.2.9 / React 19.2 / RSC / Node-runtime middleware, `output:"standalone"`, deploy-per-tenant, Docker-first).
> All stars/versions/licenses verified via web + GitHub API, **as-of 2026-07**. Star counts are point-in-time.

**Headline finding:** the AntD→Tailwind/shadcn migration was the **right enterprise call** — it trades a monolithic, runtime-CSS, RSC-hostile widget library for an owned-source, zero-runtime, primitive-based system that is RSC-native, air-gap-friendly (copy-in source, no vendored runtime), and first-class on RTL/dark since Jan 2026. The one live decision the migration surfaced is the **primitive layer**: shadcn/ui changed its *default* from Radix → **Base UI in July 2026** (see current-events). We are on Radix, which is still dual-shipped and production-safe, but the maintenance center of gravity moved to Base UI.

---

### tailwindcss@4 (+ @tailwindcss/postcss)
**One line:** Utility-first, CSS-first (`@theme`) engine with the Rust "Oxide" + Lightning CSS pipeline; **our current choice** and the substrate the whole design system sits on.

| # | Candidate | Lens | Stars (2026-07) | License | Maturity | Why it ranks |
|---|-----------|------|-----------------|---------|----------|--------------|
| 1 | **tailwindcss v4** (ours) | BT·HS·OSS | 95.9k | MIT | v4 (2025), since 2017 | Zero-runtime, RSC-safe, largest ecosystem (shadcn/Radix/Tremor all target it) |
| 2 | UnoCSS | OSS | ~17k | MIT | 2021, Anthony Fu | Atomic on-demand engine, ~ms builds, Tailwind-preset compatible; Vite-native, weaker Next fit |
| 3 | Panda CSS | OSS | ~6k | MIT | 2023, Chakra team | Type-safe build-time CSS-in-JS + recipes/tokens; design-system-first, RSC-safe |
| 4 | vanilla-extract | BT·OSS | 10.4k | MIT | 2021 | Type-safe zero-runtime CSS-in-TS; `.css.ts` authoring, strong but niche |
| 5 | StyleX | BT·ENT | 9.4k | MIT | 2024, **Meta** | Powers facebook.com at scale; atomic build-time, strict but verbose, thin ecosystem |
| 6 | CSS Modules | BT | (bundler-native) | — | ~2015 | Zero-dep, universally supported; no design-token/variant story of its own |

**Head-to-head:** All six are build-time / zero-runtime — the runtime CSS-in-JS era (Emotion/styled-components) is effectively over for RSC because runtime injection breaks streaming and adds bundle weight. Among survivors, **Tailwind wins on ecosystem gravity** (every component kit we'd consider targets it), UnoCSS wins raw build speed (imperceptible under ~50k LOC), Panda/vanilla-extract/StyleX win *type-safety* but cost ecosystem and impose an authoring dialect. StyleX is the only one with true FAANG-scale prod pedigree, but its ecosystem is thin and it fights shadcn. For an enterprise repo whose components are copy-in shadcn source, Tailwind is the only choice that keeps the component supply chain first-class.

**Recommendation: KEEP.** Fit **5/5**. MIT, RSC-native, no runtime, the ecosystem hub. No ADR change. Harden only by keeping `@theme` tokens driven from `style-dictionary` output (see tokens item) rather than hand-authored CSS vars.

---

### Radix primitives + shadcn/ui (the component system)
**One line:** shadcn = owned-source components (copied into the repo, not a dependency) built on Radix headless primitives; **our current choice** (`@radix-ui/react-*` in `package.json`). This is the category's decisive question: *is this the enterprise-grade pick on accessibility + theming + RTL + dark?*

**Headless / primitive lens (the logic+a11y layer):**

| # | Candidate | Lens | Stars/DL (2026-07) | License | Maturity | Why it ranks |
|---|-----------|------|--------------------|---------|----------|--------------|
| 1 | **Radix Primitives** (ours) | BT·OSS | ~16k · 130M/mo npm | MIT | 2020, **WorkOS** | Proven a11y/focus/RTL; but velocity slowed post-acquisition (see catch) |
| 2 | **Base UI** | HS-rising·ENT | v1.6 · 6M/wk | MIT | v1.0 Dec 2025, **MUI** | Built by ex-Radix eng; now shadcn's *default*; active dev, Combobox/Autocomplete |
| 3 | React Aria (Components) | ENT·BT | ~13.5k | Apache-2.0 | **Adobe** | Deepest a11y primitives in the ecosystem; more code per component |
| 4 | Ark UI | OSS | ~4.5k | MIT | 2023, Chakra/Zag | Multi-framework (React/Vue/Solid), XState state machines |
| 5 | Headless UI | HS | ~26k | MIT | Tailwind Labs | Tiny (~10 components), beginner-friendly, insufficient for an enterprise kit |
| 6 | Kobalte | OSS | ~2k | MIT | Solid-only | **Not React** — excluded for our stack |

**Component-kit lens (batteries-included vs owned-source):**

| # | Candidate | Lens | Stars (2026-07) | License | Why it ranks |
|---|-----------|------|-----------------|---------|--------------|
| 1 | **shadcn/ui** (ours) | HS·OSS | 118.8k | MIT | Star leader; owned source, Tailwind-native, RTL(Jan'26)+dark first-class |
| 2 | MUI (Material UI) | BT·ENT | ~97k | MIT + commercial (MUI X) | Deepest enterprise data-grid, SLA/commercial support; Material look, heavier |
| 3 | Ant Design (what we left) | BT·ENT | ~97k | MIT | Richest free enterprise set; weaker a11y, runtime CSS, RSC-awkward |
| 4 | Mantine | OSS·BT | ~28k | MIT | 120+ components + hooks; batteries-included, not owned-source |
| 5 | Chakra UI | OSS | ~40k | MIT | Best-in-class a11y ergonomics; v3 rebuilt on Panda |
| 6 | HeroUI (ex-NextUI) | OSS | ~24k | MIT | Tailwind-native, animated; built on React Aria + tailwind-variants |
| 7 | Tremor | OSS | 16.5k | MIT | **Vercel**-owned dashboard blocks/charts, shadcn-aesthetic (see charts) |
| 8 | Park UI | OSS | ~3k | MIT | shadcn-style but on **Ark UI** — multi-framework escape hatch |

**Head-to-head:** The enterprise axis is *ownership + a11y + longevity*, not component count. **shadcn's owned-source model is the enterprise differentiator**: components live in the repo (auditable, forkable, air-gap-clean, no supply-chain runtime), which is exactly what a deploy-per-tenant, Docker-first, self-hosted posture wants — MUI/AntD/Mantine all vendor a runtime you must trust and upgrade wholesale. On accessibility, Radix/Base UI/React Aria are all strong; **React Aria (Adobe) is the gold standard** if a component must be bulletproof (WCAG-audited, decades of Adobe investment), at the cost of hand-writing more. The live tension is Radix vs Base UI: **Radix is battle-tested but its dev velocity slowed after the WorkOS acquisition** (original team left, several joined MUI to build Base UI), while **Base UI is now the actively-maintained layer and shadcn's July-2026 default** — but it's young (v1.0, Dec 2025). AntD (what we left) is the clear loser here: weakest a11y of the majors, runtime CSS that fights RSC streaming, and a design language that reads "Chinese-enterprise SaaS" rather than neutral.

**Recommendation: KEEP + HARDEN.** Fit **5/5**. The migration was correct — do **not** relitigate it.
- **KEEP Radix now**: it's dual-shipped by shadcn, not deprecated, and 130M-downloads/month stable. No forced migration.
- **HARDEN**: adopt **Base UI for *new* shadcn components** going forward (it's the maintained layer + the default), and record a one-line ADR fixing the primitive-layer policy so forks don't drift half-Radix/half-Base. Keep a **React Aria** escape hatch documented for any component with hard a11y/compliance requirements (SSO login, data-entry grids).
- **ADR impact:** new "primitive-layer policy" ADR (Radix = incumbent, Base UI = new components, React Aria = a11y-critical). Supersede the AntD ADR-001 reference if still lingering.

---

### class-variance-authority + clsx + tailwind-merge (variant/utility helpers)
**One line:** The shadcn triad — `cva` builds typed variant maps, `clsx` conditionally joins classes, `tailwind-merge` de-conflicts Tailwind classes; **our current choice**, all tiny.

| # | Candidate | Lens | Stars (2026-07) | License | Maturity | Why it ranks |
|---|-----------|------|-----------------|---------|----------|--------------|
| 1 | **cva** (ours) | HS·OSS | ~6k | Apache-2.0 | v0.7.1 (**last publish Nov 2024**) | shadcn default; simple, framework-agnostic — **but dormant** |
| 2 | tailwind-variants | OSS | ~2k | MIT | HeroUI team | Superset of cva: responsive variants, slots, built-in tw-merge |
| 3 | clsx (ours) | BT·HS | ~9k | MIT | stable | 230-byte class joiner, universal |
| 4 | tailwind-merge (ours) | BT·HS | ~5k | MIT | active | Resolves conflicting Tailwind utilities; pairs with cva |

**Head-to-head:** `tailwind-variants` is a functional superset of `cva` (adds responsive variants, slots/compound-slots, and folds in `tailwind-merge`) and is **actively maintained by the HeroUI team**, whereas **cva has been dormant at 0.7.1 since Nov 2024** (~20 months; a `1.0.0-beta` exists but hasn't shipped stable). For our usage the risk is low — cva is ~2kB, feature-complete, and does one stable thing — but "unmaintained core dependency" is a real enterprise flag. `clsx` + `tailwind-merge` are both healthy and non-negotiable.

**Recommendation: KEEP + HARDEN.** Fit **4/5**. Keep the triad (ripping it out means re-authoring every shadcn component for no user benefit), but **log cva's dormancy in the findings register** as a watch item, and set the fork policy that *new* design-system primitives may use `tailwind-variants` where slots/responsive variants are needed. If cva's 1.0 stalls another year, migrate (mechanical, `tailwind-variants` has a cva-compat API). No ADR needed now.

---

### lucide-react (icons)
**One line:** Actively-maintained Feather fork, ~1,500 icons, tree-shakeable; **our current choice** and the shadcn default.

| # | Candidate | Lens | Stars/DL (2026-07) | License | Icons | Why it ranks |
|---|-----------|------|--------------------|---------|-------|--------------|
| 1 | **lucide-react** (ours) | HS·OSS | ~13k · ~5M/wk | **ISC** | ~1,500 | shadcn default, consistent stroke, clean tree-shaking |
| 2 | Heroicons | OSS | ~22k | MIT | 316 (4 styles) | Tailwind Labs; small set, very polished |
| 3 | Tabler Icons | OSS | ~21k | MIT | 5,900+ | Largest MIT stroke set, 24px/2px grid |
| 4 | Phosphor Icons | OSS | ~12k | MIT | 7,700+ (6 weights) | Most variety/weights (thin→duotone) |
| 5 | Radix Icons | OSS | ~1k | MIT | ~300 | WorkOS; small & **stagnant**, avoid as primary |

**Head-to-head:** All tree-shake cleanly, so bundle size is a wash (you ship only what you import). The differentiator is *coverage vs consistency*: Lucide's ~1,500 is enough for app chrome and is the shadcn default (so copied components already import it), Tabler/Phosphor win when you need a large or multi-weight set, Heroicons is smallest. Radix Icons is the only one to avoid — small and stagnant. ISC (Lucide) is permissive and enterprise-clean, equivalent to MIT for our purposes.

**Recommendation: KEEP.** Fit **5/5**. Default, permissive, matches shadcn. Only add Phosphor/Tabler *alongside* if a specific product needs weights or icons Lucide lacks — they coexist fine. No ADR.

---

### sonner (toasts)
**One line:** Emil Kowalski's opinionated, accessible toast; **our current choice** and the shadcn default (which deprecated its own Radix-Toast recipe in favor of it).

| # | Candidate | Lens | Stars/DL (2026-07) | License | Why it ranks |
|---|-----------|------|--------------------|---------|--------------|
| 1 | **sonner** (ours) | HS·OSS | ~11k · very high DL | MIT | shadcn default; smallest bundle (~9kB gz), a11y, Radix-portal-safe z-index |
| 2 | react-hot-toast | BT·OSS | ~10k | MIT | Minimal, battle-tested, larger bundle, less polished stacking |
| 3 | Radix Toast (primitive) | BT | (part of Radix) | MIT | Fully headless/composable but verbose; shadcn moved *off* it |

**Head-to-head:** shadcn originally shipped a Radix-Toast recipe, then **replaced it with Sonner** — the maintainer even ships a shadcn-CLI Sonner integration. Sonner is smaller, more accessible out of the box, and specifically manages z-index to coexist with Radix/Base UI portal modals (a real conflict source). react-hot-toast is a fine minimal fallback but offers no advantage for a shadcn stack. Radix Toast is the right pick only if you need to hand-build a fully bespoke notification surface.

**Recommendation: KEEP.** Fit **5/5**. Default, smallest, a11y-correct, portal-safe. No ADR.

---

### recharts (charts)
**One line:** Declarative, composable SVG chart library on D3; **our current choice**, ~50M weekly downloads — the pragmatic React default.

| # | Candidate | Lens | Stars/DL (2026-07) | License | Why it ranks |
|---|-----------|------|--------------------|---------|--------------|
| 1 | **recharts** (ours) | BT·HS·OSS | 27.1k · ~50M/wk | MIT | v3, a11y layer default, declarative JSX, covers common charts |
| 2 | ECharts (echarts-for-react) | BT·ENT·OSS | ~62k | Apache-2.0 | Canvas/WebGL; **100k+ points**, 3D, maps, drilldowns (Apache project) |
| 3 | Chart.js (react-chartjs-2) | BT·HS | ~65k | MIT | Canvas, huge chart variety, battle-tested |
| 4 | Tremor | OSS | 16.5k | MIT | **Vercel**-owned; Recharts-based, shadcn-aesthetic dashboard blocks |
| 5 | visx | OSS | 14.2k | MIT | **Airbnb**; low-level D3 primitives, ~15kB, max control |
| 6 | nivo | OSS | ~14k | MIT | 30+ types, SVG/Canvas/SSR, beautiful defaults, heavy (~500kB full) |
| 7 | VisActor | OSS | ~4k | MIT | ByteDance; newer, spec-driven, less proven |

**Head-to-head:** Recharts is the right *default* — declarative, TS-typed, SVG (crisp/accessible), and small enough. Its ceiling is data volume: SVG chokes well before ECharts' Canvas/WebGL, which is the enterprise pick for **100k+ point** dashboards, real-time streams, or geo/3D. **Tremor** (now Vercel-owned and fully OSS since the Jan-2025 acquisition) is the highest-leverage *add* here — it's Recharts under the hood but ships shadcn-styled dashboard blocks + KPI cards, so it slots into our exact aesthetic with near-zero custom work. visx is for teams that want to compose from D3 primitives (overkill for most internal tools); nivo's bundle is a liability for our size-limit gate.

**Recommendation: KEEP** (Fit **4/5**) **+ ADD-AS-OPTION.** Recharts stays the default. Document two escape hatches in `/scale-up`: **ECharts** when a chart needs >~10k points or real-time/geo/3D (Recharts' hard ceiling), and **Tremor** blocks when building a dashboard-heavy screen fast (Recharts-compatible, shadcn-native). ADR impact: a `/scale-up` recipe row, not a stack change.

---

### style-dictionary (design tokens)
**One line:** Amazon's cross-platform token build system (DTCG JSON → CSS/JS/etc.); **our current choice** wired via `scripts/build-tokens.mjs` → Tailwind `@theme`.

| # | Candidate | Lens | Stars (2026-07) | License | Role | Why it ranks |
|---|-----------|------|-----------------|---------|------|--------------|
| 1 | **style-dictionary** (ours) | BT·ENT·OSS | ~4k | Apache-2.0 | build/transform | **Amazon**; DTCG-first (v4+), the standard code-side pipeline |
| 2 | Tokens Studio | ENT | (Figma plugin) | freemium/commercial | authoring | Designer-side source of truth in Figma; DTCG export |
| 3 | Terrazzo (ex-Cobalt) | OSS | ~1k | MIT | build/transform | DTCG-native alternative to SD; cleaner config, smaller community |

**Head-to-head:** These aren't really competitors — they're stages of one pipeline: **Tokens Studio (author in Figma) → DTCG JSON → Style Dictionary (transform to code)**. The **DTCG spec reached its first stable version (2025.10)** with backing from Adobe/Google/Microsoft/Meta/Figma/Salesforce/Shopify, and SD v4+, Terrazzo, and Tokens Studio all implement it — so the interchange format is now safe to standardize on. Style Dictionary is the enterprise-grade, Apache-2.0, Amazon-maintained transform layer with the deepest platform-output support; Terrazzo is a lighter DTCG-native alternative (fine, but smaller community — no reason to switch). Tokens Studio is the *design-authoring* half we don't yet have.

**Recommendation: KEEP** (Fit **5/5**) **+ optionally ADD Tokens Studio** (design-side, net-new) if/when a designer needs to author tokens in Figma. Ensure our token source files are **DTCG-2025.10-compliant JSON** so the pipeline is portable and the Figma round-trip is possible later. No stack-change ADR; a token-policy note.

---

## Category verdict

| Item | Current | Recommendation | Net-new deps to add | ADR impact | Priority |
|------|---------|----------------|---------------------|------------|----------|
| Tailwind v4 | `tailwindcss@4` | **KEEP** | — | none | — |
| Component system | Radix + shadcn/ui | **KEEP + HARDEN** (Base UI for new components; React Aria a11y hatch) | `@base-ui/react` (as new-component layer) | **new primitive-layer ADR** | **P1** |
| Variant helpers | cva + clsx + tailwind-merge | **KEEP + HARDEN** (log cva dormancy; tailwind-variants for slots) | `tailwind-variants` (optional) | none | P2 |
| Icons | `lucide-react` | **KEEP** | — (Phosphor/Tabler only if needed) | none | — |
| Toasts | `sonner` | **KEEP** | — | none | — |
| Charts | `recharts` | **KEEP + ADD-AS-OPTION** | `echarts`/`echarts-for-react` (heavy data), `@tremor/react` (dashboards) | `/scale-up` recipe rows | P2 |
| Tokens | `style-dictionary` | **KEEP** (+ Tokens Studio, design-side) | Tokens Studio (Figma, optional) | token-policy note | P2 |

**Overall:** The AntD→Tailwind/shadcn migration was the correct enterprise decision and should not be relitigated — every item lands on KEEP. The only structural follow-up is **fixing the primitive-layer policy (Radix vs Base UI)** now that shadcn's default moved (P1); everything else is watch-list or optional add.

---

## Current-events catches (default-changing, 2025–2026)
1. **shadcn/ui switched its default primitive layer from Radix → Base UI (July 2026).** We are on Radix. It is *not* deprecated — every new shadcn component ships for both layers — but the default and the maintenance momentum moved to Base UI. Drives the P1 recommendation. [4][5]
2. **Radix UI velocity slowed after the WorkOS acquisition.** Original team largely departed; several joined MUI to build **Base UI (v1.0 Dec 2025, now v1.6, 6M weekly downloads)**. Radix still ships (130M downloads/month) but is in maintenance mode. [4]
3. **cva is dormant** — stuck at v0.7.1, last published Nov 2024 (~20 months); a 1.0 beta exists but hasn't shipped. Low-risk (tiny, stable) but a flagged watch item; `tailwind-variants` (HeroUI) is the maintained superset. [8][9]
4. **Tremor was acquired by Vercel (Jan 2025)** and is now fully free/OSS — de-risks it as a dashboard-block option. [12]
5. **DTCG design-token spec reached first stable version (2025.10)** with cross-vendor backing; Style Dictionary v4+, Terrazzo, and Tokens Studio all implement it — the token interchange format is now safe to standardize on. [7][13]

---

## Sources
1. PkgPulse — Tailwind v4 vs UnoCSS vs PandaCSS 2026 — https://www.pkgpulse.com/guides/tailwind-v4-vs-unocss-vs-pandacss-2026
2. PkgPulse — State of CSS-in-JS 2026 — https://www.pkgpulse.com/guides/state-of-css-in-js-2026
3. LogRocket — Headless UI alternatives: Radix vs React Aria vs Ark vs Base UI — https://blog.logrocket.com/headless-ui-alternatives/
4. Medium (Tamim) — Is your shadcn project at risk? Radix's future — https://medium.com/@mashuktamim/is-your-shadcn-ui-project-at-risk-a-deep-dive-into-radixs-future-91af267c4bec
5. shadcn/ui changelog — July 2026: Base UI as the default — https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default
6. shadcn/ui — RTL support (Jan 2026) — https://ui.shadcn.com/docs/changelog/2026-01-rtl
7. W3C DTCG — spec reaches first stable version (2025.10) — https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
8. npm — class-variance-authority (v0.7.1, last publish) — https://www.npmjs.com/package/class-variance-authority
9. Tailwind Variants — comparison vs cva — https://www.tailwind-variants.org/docs/comparison
10. PkgPulse — Lucide vs Heroicons vs Phosphor 2026 — https://www.pkgpulse.com/guides/lucide-vs-heroicons-vs-phosphor-react-icon-libraries-2026
11. peal.dev — Sonner vs react-hot-toast — https://www.peal.dev/blog/toast-notifications-sonner-react-hot-toast-alternatives
12. Vercel — acquires Tremor — https://vercel.com/blog/vercel-acquires-tremor
13. AI Design Guide — Style Dictionary vs Tokens Studio — https://www.aidesign.guide/compare/style-dictionary-vs-tokens-studio/
14. LogRocket — Best React chart libraries 2026 — https://blog.logrocket.com/best-react-chart-libraries-2026/
15. PkgPulse — Recharts v3 vs Tremor vs Nivo 2026 — https://www.pkgpulse.com/guides/recharts-v3-vs-tremor-vs-nivo-react-charting-2026
16. adminlte.io — shadcn/ui vs MUI vs Ant Design 2026 — https://adminlte.io/blog/shadcn-ui-vs-mui-vs-ant-design/
17. GreatFrontend — Top headless UI libraries 2026 — https://www.greatfrontend.com/blog/top-headless-ui-libraries-for-react-in-2026
18. GitHub API (2026-07) — tailwindlabs/tailwindcss 95.9k MIT; shadcn-ui/ui 118.8k MIT; recharts/recharts 27.1k MIT
