# ADR-053 — Docs site: Fumadocs, mounted inside the existing Next.js app

**Status:** Accepted (2026-07-12, Tariq Al-Naaimi)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The repo carries a large body of prose — `README.md`, `SECURITY.md`, the `docs/*.md`
guides, and the `docs/decisions/ADR-*.md` series — but has **no rendered docs site**.
Today that content is read in-editor or on GitHub: no full-text search, no navigation
tree, no cross-reference UI, no shared browsable URL for a non-developer stakeholder.
The v2 enterprise-benchmark remaining-surface sweep (`docs/research/v2/20-remaining-sweep.md`,
surface #1 "Documentation site") flagged this as a **P1 net-new** gap and recommended
adding a docs site **as an option** (a `/scale-up` recipe), not hard-wiring it into
every fork.

The pivot constraints are the deciding forces. The template is **Docker-first /
self-host default** (ADR-006 Vercel+Neon default deploy; ADR-030/035 Docker as a
mandatory build artifact), **enterprise, deploy-per-tenant**, and locked to a
**Next.js 16 App-Router / RSC** stack (ADR-001). A docs toolchain that brings its own
build system (a second webpack/Vite/Astro/Python pipeline) means a second thing to
build, a second thing to containerize, and a second thing to keep on-rail — the exact
cost the single-image self-host model is trying to avoid. A hosted SaaS docs product
(Mintlify, GitBook) fails the self-host/data-sovereignty pivot outright.

This ADR records the tool choice; the buildable surface is specified in the companion
blueprint `docs/blueprints/docs-site-fumadocs.md`. It ships as an **opt-in** capability
(a `/scale-up` recipe), so a fork that reads `docs/` in-editor is untouched.

## Decision drivers

- **Single build, single Docker image.** A self-host-default, deploy-per-tenant template
  should not stand up a second build system beside the Next app — the docs must build in
  the same `next build` and ship in the same image (ADR-006/030/035).
- **On the locked stack.** Next.js 16 App-Router / RSC is the ADR-001 rail; the docs
  layer should be React/Next-native, not Vue/Vite/Astro/Python.
- **Self-hostable, license-clean redistribution.** The template is shipped to tenants; a
  permissive (MIT/Apache) license is required, and a hosted-SaaS docs product is
  disqualified by the self-host pivot.
- **Low ceremony / opt-in.** Most forks read `docs/` in-editor — the docs site must be an
  additive `/scale-up` option, gated behind auth for internal-only use, never a base-template tax.
- **Content stays as markdown in the repo.** Operators (non-developers) add a page by
  writing a markdown/MDX file; no CMS, no separate content service.

## Considered options

### Option 1 — Fumadocs (chosen)

A Next.js App-Router / RSC-native docs framework (`fumadocs-core` / `fumadocs-ui` /
`fumadocs-mdx`, MIT) that mounts as a route group **inside** the existing Next app.

- Good, because it is **RSC-native and mounts inside the existing Next.js 16 app** — one
  `next build`, one Docker image, no second SSG toolchain (the key differentiator, and
  the primary decision driver).
- Good, because it is on the ADR-001 locked stack (React/Next App Router), so it reuses
  the app's build, deploy, auth, and container with zero new pipeline.
- Good, because MDX content lives as files in the repo (`content/docs/**`), so an
  operator adds a page by committing markdown — no CMS.
- Good, because MIT-licensed and fully self-hostable — clean to redistribute to tenants;
  its shadcn-style "own-the-source" fork model matches the template's ethos.
- Good, because a docs route group can sit behind the existing auth wrappers for
  internal-only docs, and its OpenAPI-in-Next story ties into the future zod-openapi seam
  (sweep 7a).
- Bad, because it has **no out-of-box doc _versioning_** the way Docusaurus does — a real
  gap for heavy public versioned docs, but a deploy-per-tenant repo barely needs it.
- Bad, because it is younger (2023) and smaller-community than the Meta-backed incumbent,
  so some plugin corners are DIY.

### Option 2 — Nextra (Vercel)

Next.js/MDX docs framework (~13k ⭐, MIT) that powers shadcn/SWR docs.

- Good, because it is also Next-based and MDX-native, so it stays broadly on-rail.
- Good, because it is mature and battle-tested for public docs.
- Bad, because it is opinionated as a **standalone docs app** rather than a route group
  that drops into an existing App-Router app — the "one app, one image" fit is weaker,
  which fails the single-build driver Fumadocs wins on.
- Bad, because its App-Router/RSC integration lags Fumadocs' native design.

### Option 3 — Astro Starlight

Astro-islands docs framework (~7k ⭐, MIT) with built-in search + i18n.

- Good, because it has the fastest static builds and batteries-included search/i18n out of
  the box.
- Bad, because it is a **separate Astro toolchain** — a second build system and a second
  container concern beside the Next app, directly failing the single-build/single-image
  driver.
- Bad, because it is off the ADR-001 React/Next rail (Astro islands), so it shares nothing
  with the app's build/deploy/auth.

### Option 4 — Mintlify (hosted SaaS)

Polished hosted docs product with best-in-class OpenAPI docs + AI search; OSS CLI only.

- Good, because it delivers the most polished OpenAPI/AI-search docs UX with the least
  effort.
- Bad, because it is **hosted SaaS** — content and hosting leave the tenant, which
  **fails the self-host / data-sovereignty pivot** outright.
- Bad, because it is proprietary (only the CLI is open) — a redistribution non-starter for
  a template shipped to tenants.

### Option 5 — Plain markdown (status quo — no site)

Keep reading `docs/*.md` + `ADR-*.md` in-editor / on GitHub.

- Good, because it is zero new dependency, zero build, zero maintenance.
- Good, because GitHub already renders markdown with basic navigation for developers.
- Bad, because there is **no full-text search, no navigation tree, no shared browsable
  URL** for a non-developer stakeholder — the exact gap the sweep flagged.
- Bad, because ADRs and cross-references are hard to browse as a coherent site; discovery
  is poor as the corpus grows.

## Decision

Adopt **Fumadocs** as the project docs-site tool, shipped as an **opt-in `/scale-up`
recipe** (not hard-wired into the base template). The deciding driver is **single build,
single Docker image**: Fumadocs is the only React/Next-native, self-hostable, MIT option
that mounts as a route group **inside** the existing Next.js 16 app, so the docs render
through the same `next build`, deploy on the same rail (ADR-006), and ship in the same
Docker image (ADR-030/035) with no second toolchain. Nextra stays broadly on-rail but is
shaped as a standalone docs app; Starlight and VitePress each drag in a separate
build system off the ADR-001 rail; Mintlify/GitBook fail the self-host pivot. **Docusaurus
remains the documented fallback** for the rare tenant that demands heavy versioned/i18n
_public_ docs — its own webpack build is the price for native versioning Fumadocs lacks.

Net-new dependencies are `fumadocs-core` / `fumadocs-ui` / `fumadocs-mdx` (MIT, React —
on-rail, no Ask-before-dep concern). The docs route group can sit behind the existing auth
wrappers for internal-only docs.

## Consequences

### Positive

- One build and one Docker image: the docs site adds no second pipeline and no second
  container to the self-host/deploy-per-tenant model.
- Content is markdown/MDX in the repo, so a non-developer operator publishes a page by
  committing a file — the existing `docs/` corpus (guides + ADRs) gets search, nav, and a
  shareable URL.
- Stays on the ADR-001 locked stack and reuses the app's auth wrappers, so internal-only
  docs are gated with the same primitives.
- MIT + self-hostable keeps redistribution to tenants clean; the shadcn-style fork model
  matches the template's own-the-source ethos.

### Negative

- No out-of-box doc versioning (Fumadocs' one real gap vs Docusaurus) — a real cost only
  for heavily versioned public docs, which a deploy-per-tenant repo rarely has.
- A younger, smaller ecosystem than Docusaurus/Nextra — some advanced features are DIY.
- Adds three runtime/build deps and a `content/docs/**` tree to maintain in forks that opt in.

### Mitigations

- Ship it as an **opt-in `/scale-up` recipe**, so forks that don't want a docs site pay
  nothing and the base-template build is untouched.
- Keep **Docusaurus documented as the fallback** for the versioned/i18n-public-docs case,
  so the one gap has a named escape hatch.
- Gate the docs route group behind the existing auth wrappers for internal-only content —
  no new auth surface, no Restricted-data exposure.
- Pin the `fumadocs-*` deps in-range (ADR-017 cadence) and treat `source.config.ts` /
  `lib/docs/**` as ordinary reviewed source under `/ship`.

## Alternatives considered

1. **Nextra** — Next/MDX, but shaped as a standalone docs app rather than an in-app route
   group; weaker single-build/single-image fit than Fumadocs.
2. **Astro Starlight** — fast + batteries-included, but a separate Astro toolchain off the
   React/Next rail (second build system).
3. **VitePress** — excellent DX, but Vue/Vite — off the ADR-001 React/Next rail.
4. **Mintlify / GitBook (SaaS)** — best polished OpenAPI/AI-search UX, but hosted
   proprietary SaaS — fails the self-host pivot.
5. **Docusaurus** — most battle-tested, native versioning + i18n, but its own webpack build
   is a second build system beside the Next app; **kept as the documented fallback** for
   heavy versioned/i18n public docs.
6. **Plain markdown (status quo)** — zero-cost, but no search / nav / shareable URL — the
   gap this ADR closes.

## Migration triggers

Revisit this decision when any of the following hold:

- A tenant requires **heavy versioned or multi-locale _public_ docs** at a scale
  Fumadocs' DIY versioning can't carry — switch that fork to the Docusaurus fallback.
- Fumadocs' Next.js 16 App-Router / RSC support regresses or its maintenance stalls (star
  velocity flat + unpatched Next-major breakage) — re-benchmark against Nextra.
- The docs site needs to be **hosted separately** from the app (a public docs domain
  decoupled from the tenant deploy) — re-evaluate the single-image assumption that anchors
  this choice.
- The `fumadocs-*` license changes off MIT — reassess redistribution to tenants.

## Related

- `docs/research/v2/20-remaining-sweep.md` — surface #1 "Documentation site" (Fumadocs vs
  Nextra vs Starlight vs VitePress vs Mintlify vs Docusaurus; the source benchmark).
- ADR-006 — Vercel + Neon default deploy; the Docker-first / self-host posture Fumadocs'
  single-image fit serves.
- ADR-030 / ADR-035 — Docker as a mandatory build artifact; the "one image" the docs site
  must ship inside.
- ADR-001 — locked stack (Next.js 16 App-Router / RSC) the docs tool must stay on.
- ADR-017 — dependency cadence for the `fumadocs-*` deps.
- Blueprint: `docs/blueprints/docs-site-fumadocs.md` (the buildable surface this ADR authorizes).
- Sweep 7a (zod-openapi + Scalar) — the OpenAPI-in-Next docs story that folds into this site.

## Amendment (2026-07-13) — enabler template mechanism

Two opt-in enablers now coexist with different file-emission mechanisms:
`enable-api-reference.mjs` embeds its 2 small files as inline template-literal
strings; `enable-docs-site.mjs` copies byte-exact `.tpl` snapshots from
`scripts/templates/docs-site/**`. Decision rule for future `enable-*.mjs`
scripts: **inline strings for ≤2 tiny files; a `.tpl` template directory for
anything larger** (real syntax highlighting, no backtick/`${}` escaping hazard,
diffable, and git tracks moves as renames). The `.tpl` suffix keeps emitted-but-
dormant code out of the pristine template's tsc/eslint/prettier/knip sweeps.
