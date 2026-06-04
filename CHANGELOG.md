# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

On the Vercel + Neon rail (ADR-006) there is no release/tag workflow: pushing to
`main` deploys to production, and a rollback is a `git revert` (or "Promote to
Production" on a prior Vercel deployment). Record notable changes here by hand.
The pre-pivot `/promote` + `release.yml` tag flow was removed with ADR-006.

## [Unreleased]

### Added
- Password-reset flow: forgot-password + reset-password API routes and pages (token-based, emailed via `lib/email.ts`).
- RSC-wired dashboard: the home dashboard now reads its data server-side (React Server Components) instead of client fetches.
- Public API surface: `/api/v1/*` rewrite plus Bearer-token (`withApiAuth`) and SSO role-map seams for future external/IdP integration (ADR-013).
- Per-route rate limiting helper `withRateLimit(handler, { id, limit, windowMs })`; scaffolded write routes now use it (`{ limit: 30, windowMs: 60000 }`).
- ADR-010 (audit completeness + atomicity), ADR-011 (tenancy by deployment), ADR-012 (stay REST + zod, not tRPC), ADR-013 (API versioning + auth/SSO seams).
- `SECURITY.md` §16: shared-tier checklist.
- CodeQL scanning with SARIF upload; SHA-pinned GitHub Actions; Dependabot.
- Component and auth test suites.
- `withEditorAuth` wrapper (`lib/api-helpers.ts`): ADMIN or EDITOR may write, VIEWER is rejected — for editor-writable routes.
- Scaffold `--writes admin|editor|any` flag to pick the write-route auth wrapper (`withAdminAuth` / `withEditorAuth` / `withAuth`; default `any`; GET always `withAuth`). EDITOR write routes are now reachable. `--admin-writes` retained as a back-compat alias.
- DB integration test suite (`npm run test:integration`) exercising the audit + soft-delete paths against a live Postgres.
- ESLint RuleTester tests for the local `rihal-template/*` plugin (`npm run test:lint-rules`).
- AGENTS.md — cross-tool AI-assistant pointer to `CLAUDE.md` / `SECURITY.md`.

### Changed
- Charts and Kanban board are now lazy-loaded (dynamic import) to cut the initial bundle.
- Recycling bin is paginated.
- Scaffold parity with the User reference: generated entities now get server-side sort (`SORTABLE_COLUMNS` allowlist + `?sort=&order=`), server-side search (`?search=` when a string/text field exists), i18n companion file (merge into `en.json`/`ar.json`), `@@index` for indexed fields + relation FKs, a debounced searchable `RelationSelect`, and per-route rate limiting on writes.
- Password-reset flow is now fully internationalized (en/ar) — request and reset pages plus emailed copy.
- Ant Design `Space` migrated from the deprecated `direction` prop to `orientation` across the UI.

### Security
- Token comparisons in `withInternalAuth` / `withApiAuth` now use constant-time `timingSafeEqual` to close a timing side-channel on the shared-secret / Bearer-token checks.

### Fixed
- `useCrud`: abort in-flight requests and resolve the race where a stale response could overwrite newer state.
- Audit extension: correctly handle `update`/`delete` with a non-`id` `where` clause.
- Soft-delete: `@@index([deletedAt])` migration so the per-read `deletedAt: null` filter is indexed.
