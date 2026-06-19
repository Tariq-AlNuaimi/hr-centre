# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

On the Vercel + Neon rail (ADR-006) there is no active release/tag workflow on the
free plan: pushing to `main` deploys to production, and a rollback is a `git revert`
(or "Promote to Production" on a prior Vercel deployment). Record notable changes here
by hand. Versioned releases + auto CHANGELOG are available via Changesets
(`npm run changeset`), wired into a **dormant** `release.yml` that activates at `/handoff`
when the IT team's paid plan runs Actions.

## [Unreleased]

### Added
- Husky `pre-push` hook (BM-1) running `npm run ship` — the gate is now enforced by structure, not memory, on every push (the active enforcement while CI is dormant on the free plan; bypass with `git push --no-verify`).
- Automated accessibility gate: `tests/uat/a11y.full.uat.ts` runs `@axe-core/playwright` against every main dashboard section and fails on serious/critical WCAG 2.0/2.1 A+AA violations (DQ-3).
- `npm run sbom` (CycloneDX production SBOM) and `npm run audit:warn` (non-gating moderate+ audit incl. dev deps) for supply-chain visibility (BM-7); `npm run test:coverage` (node test-runner coverage on the contract suite).
- Password-reset flow: forgot-password + reset-password API routes and pages (token-based, emailed via `lib/email.ts`).
- RSC-wired dashboard: the home dashboard now reads its data server-side (React Server Components) instead of client fetches.
- Public API surface: `/api/v1/*` rewrite plus Bearer-token (`withApiAuth`) and SSO role-map seams for future external/IdP integration (ADR-013).
- Per-route rate limiting helper `withRateLimit(handler, { id, limit, windowMs })`; scaffolded write routes now use it (`{ limit: 30, windowMs: 60000 }`).
- Client data layer on TanStack Query (ADR-021): `hooks/use-entity-queries.ts` query/mutation factories with shared query-key conventions, request dedupe, and centralized cache invalidation, with `QueryClientProvider` wired into the locale providers — superseding the ad-hoc `useCrud` fetch hook (now `@deprecated`).
- ADR-010 (audit completeness + atomicity), ADR-011 (tenancy by deployment), ADR-012 (stay REST + zod, not tRPC), ADR-013 (API versioning + auth/SSO seams), ADR-021 (client data layer on TanStack Query).
- `SECURITY.md` §16: shared-tier checklist.
- CodeQL scanning with SARIF upload; SHA-pinned GitHub Actions; Dependabot.
- Component and auth test suites.
- `withEditorAuth` wrapper (`lib/api-helpers.ts`): ADMIN or EDITOR may write, VIEWER is rejected — for editor-writable routes.
- Scaffold `--writes admin|editor|any` flag to pick the write-route auth wrapper (`withAdminAuth` / `withEditorAuth` / `withAuth`; default `any`; GET always `withAuth`). EDITOR write routes are now reachable. `--admin-writes` retained as a back-compat alias.
- DB integration test suite (`npm run test:integration`) exercising the audit + soft-delete paths against a live Postgres.
- ESLint RuleTester tests for the local `rihal-template/*` plugin (`npm run test:lint-rules`).
- AGENTS.md — cross-tool AI-assistant pointer to `CLAUDE.md` / `SECURITY.md`.
- Changesets release tooling (dormant): `@changesets/cli`, `.changeset/` config, `npm run changeset` / `changeset:version` scripts, and a dormant `release.yml` workflow that activates at `/handoff` for versioned releases + auto CHANGELOG.

### Changed
- Charts and Kanban board are now lazy-loaded (dynamic import) to cut the initial bundle.
- Recycling bin is paginated.
- Scaffold parity with the User reference: generated entities now get server-side sort (`SORTABLE_COLUMNS` allowlist + `?sort=&order=`), server-side search (`?search=` when a string/text field exists), i18n companion file (merge into `en.json`/`ar.json`), `@@index` for indexed fields + relation FKs, a debounced searchable `RelationSelect`, and per-route rate limiting on writes.
- Password-reset flow is now fully internationalized (en/ar) — request and reset pages plus emailed copy.
- Ant Design `Space` migrated from the deprecated `direction` prop to `orientation` across the UI.
- DataTable search is debounced (one query per pause, not per keystroke); table date cells use hoisted `Intl.DateTimeFormat` formatters (`lib/format.ts`); the recycling-bin list queries every type in parallel; the dashboard aggregate is short-TTL cached.

### Removed
- `hooks/use-crud.ts` — the deprecated imperative CRUD hook, superseded by the TanStack Query layer (`hooks/use-entity-queries.ts`, ADR-021). No remaining consumers.

### Security
- Token comparisons in `withInternalAuth` / `withApiAuth` now use constant-time `timingSafeEqual` to close a timing side-channel on the shared-secret / Bearer-token checks.
- `rihal-template/no-raw-sql-unsafe` ESLint rule (at `error`): bans `$queryRawUnsafe` / `$executeRawUnsafe` — unparameterized raw SQL is a direct injection vector (OWASP A03). Parameterized `$queryRaw` / `$executeRaw` tagged templates remain allowed. Brings the local plugin to seven rules.
- `rihal-template/no-rate-limit-inside-auth` ESLint rule (at `error`): enforces the ordering invariant that `withRateLimit` composes OUTSIDE the auth wrapper, so abusive/unauthenticated floods are throttled before any auth work (session lookup / bcrypt / secret compare) runs (OWASP A04). Brings the local plugin to eight rules.
- `rihal-template/no-restricted-export-column` ESLint rule (at `error`): bans a Restricted/secret-named field (the `SCRUB_FIELDS` set + a forward-safe secret-name pattern) as a `toExcel` column key — export output is a separate egress gate that `SCRUB_FIELDS` does not cover, so a raw secret column would otherwise dump into the downloadable `.xlsx` (SECURITY.md §1). `tests/contracts/export-column-completeness.test.ts` keeps the rule's denylist a superset of `SCRUB_FIELDS`. Brings the local plugin to nine rules.
- `rihal-template/no-prisma-unfiltered-import` ESLint rule (at `error`): restricts the raw `prismaUnfiltered` client (which bypasses the soft-delete filter and audit guarantees) to an allowlist of files that legitimately need it — `lib/auth.ts`, the prisma lib, and the `auth` / `recycling-bin` / `audit-log` / `internal` / `health` route groups. An ordinary feature route importing it now fails `/ship`, so the soft-delete + audit invariants can't be silently dropped; adding a new caller is a deliberate (Ask-before) allowlist edit. `tests/**` + `scripts/**` are exempt. Brings the local plugin to ten rules.

### Fixed
- `useCrud`: abort in-flight requests and resolve the race where a stale response could overwrite newer state.
- Audit extension: correctly handle `update`/`delete` with a non-`id` `where` clause.
- Soft-delete: `@@index([deletedAt])` migration so the per-read `deletedAt: null` filter is indexed.
