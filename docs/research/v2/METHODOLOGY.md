# Enterprise Benchmark v2 — Shared Methodology (binding for every research agent)

> This is the **exhaustive** pass. For **every item** in the catalogue, produce a
> full 4-lens **top-10** comparison, compare candidates within each lens and items
> against each other, and end each item with a **Recommendation** (adopt / keep /
> replace / what-to-change) aimed at "the perfect enterprise repo."

## The fixed stack you score against (ground truth — from `package.json`, NOT the stale CLAUDE.md)

- **Framework/runtime:** Next.js 16.2.9 (App Router, RSC, Node-runtime middleware) · React 19.2 · TypeScript 5 · Node 22 · build `output:"standalone"` (gated `DOCKER_BUILD=1`).
- **Data:** Prisma 7.7 + `@prisma/adapter-pg` + `pg` 8 · PostgreSQL 17. No vector store yet.
- **Auth:** Auth.js v5 (`next-auth@5.0.0-beta.31`) + `@auth/prisma-adapter` + `bcryptjs`; JWT sessions; 3-role enum; Entra ID opt-in (ADR-024).
- **UI (already migrated OFF Ant Design → Tailwind/shadcn):** Tailwind v4 + Radix primitives + shadcn (via MCP) + `class-variance-authority`/`clsx`/`tailwind-merge` + `lucide-react` icons + `sonner` toasts + `recharts` + `@tanstack/react-table` + `@dnd-kit/core` + `style-dictionary` tokens.
- **Forms/data:** `react-hook-form` + `@hookform/resolvers` + `zod` 3 · `@tanstack/react-query`.
- **Obs:** `@sentry/nextjs` · `@vercel/speed-insights`. **Services:** `nodemailer`, in-memory rate-limit, `exceljs` export.
- **Testing:** `node:test` + `tsx` + `@testing-library/react` + `jsdom`/`global-jsdom` + `@playwright/test` + `@axe-core/playwright` + `fast-check`.
- **Tooling/gates:** ESLint 9 (+ 10 local security rules) · `knip` · `jscpd` · `size-limit` · `@next/bundle-analyzer` · `react-scan` · `@lhci/cli` · `husky` · `@changesets/cli` · `@cyclonedx/cyclonedx-npm` (SBOM) · gitleaks + trivy (in `/ship`).

## The pivot (binding operator decisions — honor them, don't relitigate)

Enterprise-only (drop the prototype/personal tier); **deploy-per-tenant** (NO in-app row-level multi-tenancy); **Docker-first delivery**, self-hosted dockerized Postgres default (Neon optional); **compose now, k8s-ready later** (no k8s in v1); Claude-first for AI (default Opus 4.8 / Sonnet 5 / Haiku 4.5); agent runtime = research decides.

## Per-item output structure (MANDATORY — repeat for every catalogue item)

For each item, emit a `### <Item name>` block with:

1. **One line:** what the item is + our current choice (or "NET-NEW — none yet").
2. **The 4-lens top-10 table.** A single table (or four short tables) giving the **top ~10 candidates**, each tagged with which lens(es) it wins. Columns:
   `# | Candidate | Lens tag(s) | Stars (as-of date) | License | Maturity/first-release | One-line why-it-ranks`
   - **Lens tags:** `BT`=battle-tested (proven in prod at scale, long track record), `HS`=highest-star / most-popular, `ENT`=enterprise-grade (SSO/SLA/compliance/commercial backing/air-gap), `OSS`=best pure open-source (permissive license, self-hostable, healthy community). A candidate can hold several tags — tag all that apply. Aim for ~10 distinct candidates spanning all four lenses (not 40 rows); if a lens has fewer than a couple credible picks, say so.
   - **Verify stars, versions, licenses, and "enterprise uses X" via the web (today is 2026-07 — do NOT trust memory).** Put the as-of date in the Stars cell.
3. **Head-to-head:** 2–5 sentences comparing the leading candidates against EACH OTHER (the real trade-offs: lock-in, TS-native, self-hostable, RSC/Next-16 fit, license traps, ops burden).
4. **Recommendation (the payoff column):** one of `KEEP` / `KEEP+HARDEN` / `ADOPT (net-new)` / `REPLACE → <x>` / `ADD-AS-OPTION` / `DEFER`, plus **what we take or change** to reach the perfect enterprise repo, plus **Fit 1–5** vs the fixed stack and any **ADR impact**.

## Cross-item comparison (per category, once)

End the file with a **category verdict table**: `Item | Current | Recommendation | Net-new deps to add | ADR impact | Priority P0/P1/P2` — so items can be compared against each other at a glance.

## Rules

- **Cite everything non-obvious** — numbered `Sources` list at the file end; inline `[n]`. Prefer official docs, GitHub repos (with star counts + date), reputable 2025–2026 comparisons. Star counts are point-in-time — always date them.
- Tables over prose. Be decision-grade and terse; a top-10 row is one line.
- Honor the pivot decisions above (e.g. never recommend in-app multi-tenancy).
- Flag **current-events catches** (a tool that went unmaintained / changed license / had a 2025–2026 security incident) — these change defaults and are high-value.
- Write your file with the Write tool at the path you're told. Return a 5-bullet summary: top KEEP-as-is, top REPLACE calls, and any current-events catch.
