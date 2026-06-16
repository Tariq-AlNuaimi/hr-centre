# Fullstack Next.js Template (Prototype Rail)

Fast prototype rail for Rihal internal tools. Next.js 16 + Prisma + Postgres + Auth.js + Ant Design, deployed to Vercel + Neon. **`git push` → live URL in 90 seconds.**

The audience is non-developer stakeholders. They review prototypes via shared URLs (`<slug>.vercel.app`). The operator (working with Claude Code) iterates with them until approved. Then `/handoff` produces a clean package for the IT team to take over.

## Stack

- **Framework**: Next.js 16, React 19, TypeScript
- **UI**: Ant Design 6 with dark mode and RTL support
- **Database**: PostgreSQL 17 via Prisma 7 (Neon in prod, local Postgres in dev)
- **Auth**: Auth.js v5 (credentials + optional OAuth)
- **i18n**: next-intl (English + Arabic)
- **Hosting**: Vercel (auto-deploy on git push) + Neon (managed Postgres)
- **Observability**: Sentry (optional)

## Features out of the box

- Full audit trail on all entity changes (create, update, delete, restore)
- Soft deletion with recycling bin (restore or permanently delete)
- Password-reset flow (forgot / reset, token-based, emailed)
- Server-rendered (RSC) dashboard wired to live data
- Versioned public API surface (`/api/v1`) with Bearer-token + SSO role-map seams
- Role-based access control (Admin, Editor, Viewer)
- Reusable layout with header, collapsible sidebar, breadcrumbs, footer
- Dark mode toggle with system preference detection
- RTL support for Arabic locale
- Reusable DataTable with pagination, search, sort
- Reusable Chart component (line / bar / area / pie via recharts)
- Reusable KanbanBoard (drag-drop via @dnd-kit)
- Excel export helper
- Email sender (nodemailer, optional)
- Health check endpoint
- Ten local ESLint rules guarding the template's invariants

## Claude Code

`.claude/` ships with a permission allowlist, a SessionStart hook that boots dependencies, and these skills:

- **`/new-project`** — one-shot provisioner: GitHub repo + Neon + Vercel + Cloudflare DNS (via GitHub Actions)
- **`/first-fork`** — one-time setup: Vercel + Neon + first deploy (~10 min)
- **`/deploy`** — provision Neon + Vercel for the current fork and ship it to a live URL headlessly
- **`/quickstart`** — turn one paragraph of an idea into a live URL
- **`/scaffold-entity <Name>`** — generate a full CRUD entity (model, validation, API routes, dashboard page) following the soft-delete + audit + RBAC invariants
- **`/scale-up`** — add file uploads / cron / background jobs / realtime when the project needs them
- **`/ship`** — pre-push gate: typecheck + lint + tests + build + gitleaks + npm audit (stops on first failure)
- **`/audit`** — on-demand security scan of any path (gitleaks + npm audit + Semgrep)
- **`/uat`** — browser-driven acceptance walkthrough in Chromium (Playwright), with screenshots
- **`/conform`** — bring foreign code up to this template's standard (report-and-approve)
- **`/handoff`** — produce clean handoff package for the IT team
- **`/rebrand`** — sweep template defaults to the new project's name
- **`/migrate-from`** — port a feature out of a monolith
- **`/adr`** — record a decision

Humans coding by hand can ignore `.claude/`; it does not affect the runtime build. See [`CLAUDE.md`](./CLAUDE.md) for the rationale and the full hard-rules list.

## Quick Start

### Fork it and run /first-fork

In a Claude session on the new fork: type `/first-fork`. The skill walks through Vercel signup, Neon signup, env vars, and the first deploy in ~10 minutes.

### Or set up manually

```bash
# 1. Fork the template (gh CLI or via the UI)
gh repo create <owner>/<slug> --template Tariq-AlNuaimi/fullstack-vibe-template --private --clone
cd <slug>

# 2. Rebrand
npm install
npm run rebrand -- --slug <slug> --name '<Display Name>' --owner <owner>
git add -A && git commit -m 'chore: rebrand from template' && git push

# 3. Create a Neon project at https://console.neon.tech, copy the pooled connection string.

# 4. Create a Vercel project at https://vercel.com/new (import the GitHub repo).
#    Set env vars: DATABASE_URL (Neon pooled), AUTH_SECRET (openssl rand -base64 32),
#    NEXT_PUBLIC_APP_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD.

# 5. Redeploy in Vercel. Done -- your URL is live.

# 6. Seed the admin user (run once, with Neon DIRECT URL):
DATABASE_URL="<direct neon url>" npx prisma db seed
```

### Local development

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL (any local or hosted Postgres), AUTH_SECRET, NEXT_PUBLIC_APP_NAME
npm install
make db-up               # starts local Postgres in Docker
npx prisma migrate dev
npx prisma db seed
npm run dev              # http://localhost:3000
```

Log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from your `.env`.

## Project Structure

```
.claude/                     # Claude Code harness (settings + hook + skills)
app/
  [locale]/                  # i18n locale segment (en, ar)
    (auth)/login/            # Login page (no sidebar)
    (dashboard)/             # Main app with sidebar layout
      users/                 # Example CRUD entity
      recycling-bin/         # Soft-deleted records
      settings/              # App settings + profile
  api/                       # API routes
    auth/                    # Auth.js handlers
    users/                   # User CRUD endpoints
    recycling-bin/           # Restore + permanent delete
    audit-log/               # Audit log viewer
    health/                  # Health check
    internal/                # /api/internal/* -- wrapped with withInternalAuth
components/
  layout/                    # AppShell, Header, Sidebar, Footer, Breadcrumbs
  shared/                    # DataTable, Chart, KanbanBoard, ConfirmAction, EmptyState
  users/                     # Example entity components
hooks/                       # use-entity-queries (TanStack Query), useNotify, useBreadcrumb
lib/                         # Prisma client, auth, email, export, validations
prisma/                      # Schema, migrations, seed
docs/decisions/              # ADRs
eslint-rules/                # Project-local ESLint plugin (10 hard rules)
tests/contracts/             # Contract test suite (node:test)
.github/workflows/           # verify, secrets-scan, sast, codeql, uat, preview-uat, release, new-project (all dispatch-only on free plan)
```

## Adding a New Entity

In a Claude session, run **`/scaffold-entity <Name>`**. The skill walks the prompts.

Manual recipe:

```sh
npm run scaffold -- --name MyEntity \
  --fields 'title:string,note:string?,price:int,status:STATUS' \
  --enums 'status:DRAFT|PUBLISHED' \
  --relations 'owner:User?' \
  --writes editor
npx prisma generate
npx prisma migrate dev --name add_my_entity
```

`--writes admin|editor|any` selects the auth wrapper for the write routes (POST/PUT/DELETE): `admin` → `withAdminAuth` (ADMIN only), `editor` → `withEditorAuth` (ADMIN or EDITOR), `any` → `withAuth` (any authenticated user). Default is `any`; GET always uses `withAuth`. (`--admin-writes true` is kept as a back-compat alias for `--writes admin`.)

The scaffold creates: Prisma model (with soft-delete fields + audit hooks + `@@index`es), zod validation, API routes (`GET` wrapped with `withAuth`; `POST`/`PUT`/`DELETE` wrapped with the `--writes` wrapper, writes rate-limited; the list route supports server-side search/sort/pagination), a dashboard page with DataTable + Form, sidebar nav entry, and recycling-bin registration.

The generated UI uses i18n keys, so the scaffold also emits a `messages/_scaffold-<kebab>.json` companion. **Required follow-up:** merge its namespace into `messages/en.json` and `messages/ar.json` (translate the Arabic), then delete the companion — until merged, the UI renders the raw key strings. See `.claude/skills/scaffold-entity/SKILL.md`.

## CI

The workflows in `.github/workflows/` are **dormant on the free GitHub plan**
(Actions billing blocked) — they are set to `workflow_dispatch` only and gate
nothing today. The active gate is the local **`/ship`** skill, which mirrors
their checks (typecheck → lint → tests → build → gitleaks → npm audit). CI
activates at `/handoff` when the IT team's paid plan can run Actions:

- **verify.yml**: typecheck + lint + tests + build + `npm audit --audit-level=high` + scaffold smoke tests
- **secrets-scan.yml**: gitleaks across full git history
- **sast.yml**: Semgrep with OWASP + secrets rulesets
- **codeql.yml**: GitHub CodeQL static analysis (JS/TS)
- **release.yml**: Changesets versioning + release notes
- **uat.yml** / **preview-uat.yml** / **new-project.yml**: manual-dispatch UAT, preview-deploy UAT, and provisioner (not gates)

Vercel handles production deploys automatically on push to `main`. See `SECURITY.md` §14 / ADR-007.

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — codebase rules + harness reference
- [`SECURITY.md`](./SECURITY.md) — data classes, secrets, threat model, findings
- [`docs/decisions/`](./docs/decisions) — ADRs (start with ADR-001 for the locked stack, ADR-006 for why we're on Vercel + Neon)

## Environment Variables

See `.env.example` for all available configuration options.
