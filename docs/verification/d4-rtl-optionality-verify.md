# Workstream D verification — ADR-028 Part 1: optional Arabic/RTL (config-driven)

**Date:** 2026-07-02
**Verifier:** Claude (Workstream D verification pass, isolated worktree)
**Scope:** Blueprint `docs/blueprints/2026-07-replatform-and-adoption-program.md` § Workstream D, item 1
("fresh default fork shows zero RTL/ar surface; flipping `["en","ar"]` restores it; UAT already config-driven").
**Contract under test:** `docs/decisions/ADR-028-enterprise-design-system-and-optional-i18n.md` Part 1.

## Method

1. **Static trace** of every derivation in `i18n/config.ts` and every consumer (middleware, routing,
   request config, layout, header/sidebar/breadcrumbs, UAT discovery).
2. **Direct evaluation** of the derivations via `npx tsx` scripts importing `i18n/config.ts` and
   `tests/uat/_discover.ts`, under both configs.
3. **Live dev-server probes** (`next dev` with dummy `DATABASE_URL`/`AUTH_SECRET`, `curl` against
   `/`, `/en/login`, `/ar/login`) under both configs — route generation is runtime-resolved (no
   `generateStaticParams` anywhere under `app/`), so a running server is the authoritative proof,
   not `next build`.
4. **Contract suite** (`npm test`: 114 contract + 10 lint-rule tests) under both configs.
5. Config flip was worktree-local and **restored from `git show HEAD:project.config.json`**
   before this commit; `git status` clean apart from this report.

---

## Claim 1 — Default config (`locales: ["en"]`) produces English-only. **PASS**

Config source: `project.config.json:3-4` (`"locales": ["en"]`, `"defaultLocale": "en"`).

| Sub-claim                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                    | Result                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Derivations are English-only         | `i18n/config.ts:38,41,48,59,72`; tsx dump: `locales:["en"]`, `defaultLocale:"en"`, `localeDirection:{"en":"ltr"}`, `hasMultipleLocales:false`, `localePrefixRegex:"^\/(en)(?=\/                                                                                                                                                                                                             | $)"`                                                                                                                                                                                                                                                  | PASS |
| No `/ar` routes                      | `i18n/routing.ts:6-9` builds next-intl routing from config; `app/[locale]/layout.tsx:59-61` gates on `hasLocale(routing.locales, locale)` → `notFound()`. **Live:** `GET /ar/login → 307 → /en/login` (the `ar` prefix is not stripped by `localePrefixRegex`, so the path is treated as a protected non-locale path and redirected to default-locale login); `GET / → 307 → /en/login`     | PASS                                                                                                                                                                                                                                                  |
| `<html dir>` is `ltr`                | `app/[locale]/layout.tsx:64,86-88` (`directionForLocale(locale)` → `dir={direction}`). **Live:** `GET /en/login` renders `<html lang="en" dir="ltr" …>`                                                                                                                                                                                                                                     | PASS                                                                                                                                                                                                                                                  |
| `localePrefixRegex` covers only `en` | tsx dump: source `^\/(en)(?=\/                                                                                                                                                                                                                                                                                                                                                              | $)`; match tests: `/en/users→"en"`, `/ar/users→null`, `/enterprise→null`, `/arm/x→null`. Consumers all import the shared regex: `middleware.ts:6,23,121,127`; `components/layout/AppHeader.tsx:21,48`; `AppSidebar.tsx:15,35`; `Breadcrumbs.tsx:8,29` | PASS |
| Switcher hidden                      | `components/layout/AppHeader.tsx:100` — `{hasMultipleLocales && (<Button …>)}`; `i18n/config.ts:59` evaluates `false` for `["en"]` (confirmed by tsx dump)                                                                                                                                                                                                                                  | PASS                                                                                                                                                                                                                                                  |
| UAT RTL assertions skip              | `tests/uat/_discover.ts:26-43,50-56` reads `project.config.json` (same fallback semantics as `i18n/config.ts`); tsx dump: `{configuredLocales:["en"], rtlLocale:null, rtlEnabled:false}`. `tests/uat/uiux.full.uat.ts:110-128` — `rtlOk` stays vacuously `true` and a note "RTL not configured (no ar locale) — RTL assertion skipped" is recorded; the gate at `:157-158` passes vacuously | PASS                                                                                                                                                                                                                                                  |
| Contract suite green                 | `npm test` → `114 pass / 0 fail` + `10 pass / 0 fail` (after `prisma generate`; initial 5 failures were only the missing `generated/prisma` client, not i18n)                                                                                                                                                                                                                               | PASS                                                                                                                                                                                                                                                  |
| Non-locale defaults config-driven    | `app/page.tsx:2,8` redirects to `` `/${defaultLocale}` `` (no hardcoded `/en`)                                                                                                                                                                                                                                                                                                              | PASS                                                                                                                                                                                                                                                  |

## Claim 2 — Flip to `["en","ar"]` restores the full surface. **PASS**

Flip performed in this worktree only; **restored before commit** (this commit contains only this report).

| Sub-claim                   | Evidence                                                                                                                                                                                                                        | Result   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Derivations restore         | tsx dump after flip: `locales:["en","ar"]`, `localeDirection:{"en":"ltr","ar":"rtl"}`, `hasMultipleLocales:true`, `localePrefixRegex:"^\/(en                                                                                    | ar)(?=\/ | $)"`, `nextLocale("en")→"ar"`, `directionForLocale("ar")→"rtl"` | PASS |
| `/ar` routing live          | **Live:** `GET /ar/login → 200`                                                                                                                                                                                                 | PASS     |
| `dir="rtl"` for `ar`        | **Live:** `/ar/login` renders `<html lang="ar" dir="rtl" …>`; `/en/login` still `<html lang="en" dir="ltr" …>`. Direction also feeds AntD: `app/[locale]/layout.tsx:104` passes `direction` to `ThemeProvider` (ConfigProvider) | PASS     |
| Prefix regex covers both    | Match tests after flip: `/ar/users→"ar"`, `/ar→"ar"` (bare prefix), `/enterprise→null`, strip of `/ar/login` → `/login` (so `isPublicPath` in `middleware.ts:21-27` recognizes it as public)                                    | PASS     |
| Switcher visible            | `hasMultipleLocales:true` → `AppHeader.tsx:100-109` renders the toggle; target label from `LOCALE_LABELS` (`:27-30`, `en`/`ar` native names, uppercase-code fallback for unmapped locales)                                      | PASS     |
| UAT RTL assertions activate | tsx dump: `{configuredLocales:["en","ar"], rtlLocale:"ar", rtlEnabled:true}` → `uiux.full.uat.ts:111-117` asserts `<html dir>` = `rtl` on the `ar` variant as a real gate                                                       | PASS     |
| Contract suite still green  | `npm test` under flipped config → `114 pass / 0 fail` + `10 pass / 0 fail`                                                                                                                                                      | PASS     |
| Restore verified            | `project.config.json` restored byte-identical from `HEAD`; `git status --short` empty before this commit                                                                                                                        | PASS     |

## Claim 3 — `messages/ar.json` + RTL code present-but-inert by default. **PASS**

- `messages/ar.json` exists (`ls messages/` → `ar.json`, `en.json`) with **full key parity**: 151
  keys in each, zero missing / zero extra (node key-diff).
- Inert by construction: the only runtime loaders are `i18n/request.ts:12` and
  `app/[locale]/layout.tsx:63`, both locale-validated against `routing.locales` first
  (`request.ts:6-8`, `layout.tsx:59-61`) — with `["en"]`, `ar.json` is never imported.
- RTL machinery stays in the repo: `RTL_LOCALES` (`i18n/config.ts:23` and mirrored at
  `tests/uat/_discover.ts:24` — `ar/he/fa/ur`), `directionForLocale`, the ThemeProvider direction
  plumbing, and the UAT RTL variant code all remain, gated by config. Nothing deleted —
  ADR-028's reversibility stance holds (`ADR-028:27-28`).
- `scripts/scaffold-entity.mjs:1052-1060,1108-1109` still seeds new-entity strings into **both**
  `en.json` and `ar.json` regardless of config — this is what keeps the flip a true one-line
  re-enable (parity never rots). Consistent with the ADR, not drift.

## Claim 4 — Drift / bug sweep. **PASS (no defects)**

- **No surviving hardcoded `(en|ar)` regex**: repo-wide grep finds the pattern only in comments
  (`i18n/config.ts:7,70`). All six former call sites (middleware ×3, AppHeader, AppSidebar,
  Breadcrumbs) import `localePrefixRegex`.
- **No hardcoded `/en` or `/ar` route strings** in `app/` (`app/page.tsx` uses `defaultLocale`);
  the only `/ar` string literals in code are comments/fallbacks (`uiux.full.uat.ts:32,71`).
- The new regex is **stricter** than the old one: `(?=/|$)` boundary means `/enterprise` no longer
  false-matches as locale `en` (verified by evaluation) — behavior-identical for real prefixes.
- Switcher cannot render empty: hidden when single-locale; when visible, label falls back to the
  uppercased code for unmapped locales (`AppHeader.tsx:26-30,105-107`).

## Findings

| #   | Severity                | Finding                                                                                                                                                                                                                                                                                                                                                                | Suggested owner                               |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| F1  | Info (no action)        | `directionForLocale("ar")` returns `"ltr"` under the English-only config (`i18n/config.ts:48-56` builds `localeDirection` from configured locales only, `?? "ltr"` fallback). Unreachable in practice — the `hasLocale` gate 404s unconfigured locales before any render — but worth knowing if a future caller passes an arbitrary locale outside the routing gate.   | Template maintainer (docs-level note at most) |
| F2  | Info (no action)        | `nextLocale("en")` self-wraps to `"en"` in a single-locale config (`i18n/config.ts:62-65`). Harmless: its only consumer is the switcher, which is hidden when `hasMultipleLocales` is false.                                                                                                                                                                           | —                                             |
| F3  | Low (process, not code) | The Workstream D blueprint (`docs/blueprints/2026-07-replatform-and-adoption-program.md`) was not reachable from `main` at worktree-branch time; verification required merging `claude/ui-layer-signoff-replatform-onjlrr`. "Pushed-or-it-didn't-happen": land the replatform program docs on `main` promptly so future sessions/forks see them.                       | Coordinator / operator                        |
| F4  | Info (scope note)       | The full browser UAT suite was not executed end-to-end (needs Playwright + seeded auth); the config-driven skip/activate logic was verified by direct evaluation of `tests/uat/_discover.ts` exports under both configs plus code trace of `uiux.full.uat.ts:108-158`, and `<html dir>` behavior was verified live via dev-server probes. Residual risk is negligible. | —                                             |

**Code defects found: 0.**

## Conclusion

**Overall verdict: PASS.** ADR-028 Part 1 holds exactly as written: `project.config.json`
`locales`/`defaultLocale` is the single source; routing, `<html dir>`, the shared locale-prefix
regex, switcher visibility, and the UAT RTL assertions all derive from it; the default `["en"]`
fork exposes zero Arabic/RTL surface (proven live), a one-line flip to `["en","ar"]` restores the
full surface (proven live), and `messages/ar.json` + all RTL code remain present-but-inert
(reversible, nothing deleted). **Workstream D item 1 (the verification pass) can be marked
complete.** Item 2 (optional `/rebrand`-time stripping) remains an operator call — the recommendation
to keep the inert-not-deleted stance is supported by this verification. Item 3 (logical-properties
sweep) is owned by Workstream C, as the blueprint states.
