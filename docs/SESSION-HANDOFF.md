# Session handoff — Rihal Aptitude Platform

**Branch:** `claude/rihal-assessment-platform-orefdp` (all work pushed; verify `git rev-list --count @{u}..HEAD` = 0)
**Operator goal:** Build the Rihal Aptitude Assessment Platform in the 8 phases of ARCHITECTURE.md §12, **pausing for review after each phase**. Two spec files were uploaded: ARCHITECTURE.md (system/data-model/scoring/AI/phases) and UI-SPEC.md (design system + every page). They are the source of truth.

## Status: Phase 1 COMPLETE + reviewed; operator said "phase 2" → **start Phase 2 in this fresh session.**

### Key standing decision (do not relitigate)
The template shipped on **Ant Design**; the spec mandates **Tailwind v4 + shadcn/ui**. We pivoted the UI layer to Tailwind v4 + shadcn and **kept** the backend infra (Auth.js v5, Prisma 7, audit + soft-delete extensions, `lib/api-helpers`, next-intl, `middleware.ts` CSP). AntD + `@tanstack/react-query` + `@dnd-kit` were removed. The `scaffold-entity` generator + its skill/test were removed (hard-wired to the old AntD shell).

### What exists now (Phase 1)
- **Schema** (`prisma/schema.prisma`, single migration `prisma/migrations/20260627000000_init_rihal/`): `Organization` (tenant, soft-delete), `User` (+`orgId`, role `HR_ADMIN|HIRING_MANAGER` default HIRING_MANAGER), `RoleFamily` (orgId-scoped, seeded), `AuditLog` (+`orgId`), Auth.js models. Soft-delete registry (`lib/prisma/soft-delete-extension.ts`) includes User/Organization/RoleFamily.
- **Auth**: `lib/auth.ts` threads `orgId` into token/session; `mapSsoRole`→HIRING_MANAGER. `types/index.ts` adds `orgId` to Session/User/JWT. `lib/api-helpers.ts` = `withAdminAuth` (HR_ADMIN) + `withManagerAuth` (both). `lib/authz.ts` = server gating (`requireSession`/`requireAdmin`/`isAdmin`).
- **Design system**: `app/globals.css` (Tailwind v4 `@theme`, all UI-SPEC Part A tokens + shadcn semantic vars + journey-line motif). Fonts (Inter/Sora/IBM Plex Sans Arabic) in `app/[locale]/layout.tsx`. `brand.config.ts` rebranded. `postcss.config.mjs`, `components.json`, `lib/utils.ts` (`cn`). NOTE: `app/tokens.css` was deleted (folded into globals @theme).
- **shadcn primitives** in `components/ui/`: button, card, input, label, badge (with pass/partial/below signal variants), separator, avatar, dropdown-menu, sheet.
- **Shell** (`components/layout/`): `AppShell`, `SidebarNav` + `nav.ts` (NAV_ITEMS, role-gated), `MobileSidebar`, `LocaleToggle`, `ThemeToggle`, `UserMenu`. `components/providers/ThemeProvider.tsx` (next-themes, `attribute="data-theme"`, nonce). `components/brand/Wordmark.tsx`. `components/shared/`: PageHeader, StatCard, Placeholder.
- **Pages** (`app/[locale]/`): `app/` layout (session guard + org fetch) + dashboard `page.tsx`; stub pages `roles|invites|candidates|compare|calibration|settings|audit` (admin-only ones call `requireAdmin`); `(auth)/login/` (react-hook-form+zod); `methodology/` (public); `page.tsx` (→/app redirect); `not-found.tsx`, `error.tsx`. `middleware.ts` publicPaths = `/login`,`/methodology`; login redirect → `/app`.
- **i18n**: `project.config.json` locales `["en","ar"]`. Fresh `messages/en.json` + `messages/ar.json` (Rihal namespaces: common/nav/auth/shell/dashboard/placeholder/methodology/notFound/error). RTL verified.
- **Tests fixed**: `design-tokens.test.ts` (rewritten for Tailwind tokens), `auth.test.ts` + `api-auth.test.ts` (HR_ADMIN/HIRING_MANAGER, +orgId), `audit-softdelete.test.ts`.

`/ship` is GREEN (typecheck+lint+117 tests+build+gitleaks+audit). Verified runnable: local PG, migrate+seed, login, EN/AR/RTL.

### Local run recipe (proven this env)
PG16 at `/usr/lib/postgresql/16/bin`. `runuser -u postgres -- $PGBIN/initdb -D /tmp/pgqa/data -U postgres --auth=trust` → `pg_ctl ... -o "-p 5433 -k /tmp/pgqa" start` → `createdb -p 5433 -h /tmp/pgqa appdb`. Then `DATABASE_URL="postgresql://postgres@localhost:5433/appdb?schema=public"`: `npx prisma migrate deploy` + `SEED_ADMIN_EMAIL=hr@rihal.test SEED_ADMIN_PASSWORD='Passw0rd!demo' npm run prisma:seed`. Dev: add `AUTH_SECRET=...`(32+ chars) `AUTH_TRUST_HOST=true AUTH_URL=http://localhost:3000`. Playwright screenshots: `chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" })` (pinned-version mismatch otherwise). Build/migrate-diff need `DATABASE_URL` set (prisma.config.ts requires it).

### NEXT: Phase 2 — Item bank + scoring service (ARCHITECTURE §12.2, §6; UI-SPEC F)
1. **`AssessmentItemBank` model** (`itemCode, domain, facet, keyed:+|-, text_en, text_ar`) — load IPIP-NEO-120 (120 items, 5 domains × 6 facets × 4 items), public domain. Seed EN; AR translation editable (don't hardcode items — DB-driven per UI-SPEC C.2). New migration.
2. **Python FastAPI scoring microservice** wrapping `five-factor-e` (PyPI) — raw→facet/domain scores (handle reverse-keyed) + percentile calc vs **Johnson IPIP-NEO community dataset** (OSF osf.io/jxpu4). Separate service/dir; **env-var driven** endpoint (no Vercel lock-in). Unit-test scoring against known cases.
3. Wrap as a service the Next app calls via an env var URL. Keep scoring DETERMINISTIC (no LLM). Document Johnson dataset provenance/limits.
4. Adopt, don't reinvent: use `five-factor-e` keys, don't transcribe.
After Phase 2: state what's built/testable/next and **pause for operator review**.

### Watch-outs
- LLM (Phases 3/6) → env var `litellm.rihal.dev` / `gpt-oss-120b` only, never public API. AI bounded to 2 roles (profile drafting w/ human approval; numeric narration). All scoring is code.
- Calibration loop + audit must exist from day one (OutcomeRecord/ProfileCalibration land in their phases; AuditLog already present).
- `senior-code-reviewer` pass still owed on the Phase-1 change (touched auth/schema/lib) — operator was offered it; run before/at next milestone.
- Next dev shows a dev-tools overlay circle bottom-left (not a UI bug).
- Spec files are uploads in the original session; their content is summarized in ARCHITECTURE.md/UISPEC.md uploads — re-read §6/§12 + UI-SPEC C.2/F before Phase 2.
