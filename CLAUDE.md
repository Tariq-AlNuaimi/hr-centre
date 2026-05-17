# CLAUDE.md — Fullstack Next.js Template

Reusable starter for Rihal internal tools. Next.js 16 + Prisma 7 (Postgres) + Auth.js v5 + MinIO + Ant Design + next-intl. Deploys as a single Docker image to a Portainer-managed host via GHCR webhook. Owner: Tariq Al-Naaimi.

**This is the template.** When you fork it into a project, replace this section with the project-specific intro, owners, environments, and ADR references. Sections below describe what the template ships out of the box — treat them as defaults to keep, tighten, or replace.

## Read before non-trivial work
- `@README.md` — stack overview, project structure, deployment recipe
- `SECURITY.md` — data classes, secrets, threat model, open findings T-01..T-09 (read before touching auth / data / secrets / a finding)
- `prisma/schema.prisma` — the source of truth for the data model
- `lib/prisma/audit-extension.ts` + `lib/prisma/soft-delete-extension.ts` — invariants the rest of the codebase relies on

## Vibe-coding harness (`.claude/`)
This template is tuned for Claude Code sessions. Humans coding by hand can ignore `.claude/`; it does not affect the runtime build.

- **Permission allowlist** (`.claude/settings.json`) pre-approves the common loop — npm, prisma, docker compose, make, non-destructive git (including pushes to any branch). Force pushes, `rm -rf`, `git reset --hard`, `git commit --amend`, and branch deletes still prompt.
- **SessionStart hook** (`.claude/hooks/session-start.sh`) runs synchronously on session boot: copies `.env.example` → `.env` if missing, runs `npm install` if `node_modules` is missing, runs `prisma generate` if the client is missing. The hook does NOT start Docker containers — run `make db-up` once when you actually need the DB. The first prompt won't be accepted until the hook returns.
- **Skills** in `.claude/skills/`:
  - `/scaffold-entity <Name>` — generates the seven moving parts for a new CRUD entity (model, soft-delete registration, recycling-bin registration, zod validation, list + item API routes, dashboard page). Stops at file generation so you review the schema diff before `prisma migrate`.
  - `/ship` — pre-commit verification: typecheck → lint → build. Stops at the first failure with file:line.

All harness files are project-name-agnostic and survive forks unchanged.

## Stack
- **Framework:** Next.js 16 (App Router, `output: "standalone"`) · React 19 · TypeScript 5
- **UI:** Ant Design 6 + `@ant-design/nextjs-registry` · dark-mode toggle · RTL for `ar` locale
- **i18n:** `next-intl` 4 · locales `en`, `ar` · routing under `app/[locale]/`
- **ORM:** Prisma 7 + `@prisma/adapter-pg` · Postgres 17 · generated client at `generated/prisma`
- **Auth:** Auth.js v5 (`next-auth@beta`) · Credentials provider (email + bcryptjs) · JWT session strategy · Google OAuth wired but commented out (uncomment + set `AUTH_GOOGLE_*` to enable)
- **Storage:** MinIO (S3-compatible) via `@aws-sdk/client-s3` + presigned URLs (`lib/storage.ts`)
- **Validation:** `zod` (env parsing in `lib/env.ts`, per-route schemas in `lib/validations/`)
- **Edge:** none — Next.js serves directly on `:3000`. Put a TLS-terminating reverse proxy in front in production.
- **Host (default):** Portainer-managed Docker host. CI pushes images to `ghcr.io/rihal-om/fullstack-next-template`; a Portainer webhook redeploys on push to `main`.

## Hard rules
- **Never commit `.env`.** `.env.example` is in git; real secrets are environment variables on the host (set via Portainer / repo secrets). Auth, DB, and MinIO credentials are all Restricted — see `SECURITY.md` §1.
- **Never log** `AUTH_SECRET`, `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY` / `MINIO_ROOT_PASSWORD`, `SEED_ADMIN_PASSWORD`, any `passwordHash`, any presigned URL, or any session token / JWT. Full list in `SECURITY.md` §1.
- **Go through Prisma.** No raw SQL except via `prisma.$queryRaw` with parameter placeholders. Never `prisma.$executeRawUnsafe` on user input.
- **UI → API route → service → Prisma.** Server components and API routes are the only places that touch `prisma`. Client components call `/api/*`, never `prisma`.
- **Use the auth wrappers.** Every API route handler wraps with `withAuth` or `withAdminAuth` from `lib/api-helpers.ts`. Bare handlers must justify it in the PR description. The wrappers also seed the audit context — bypassing them breaks audit attribution.
- **Audit is automatic but fragile.** `auditExtension` runs on every Prisma `create` / `update` / `delete` outside the EXCLUDE set (`AuditLog`, `Account`, `Session`, `VerificationToken`). Don't add new models to that EXCLUDE set without an ADR. Don't write to `audit_logs` directly — let the extension do it.
- **Soft-delete is opt-in.** A model only participates if it has `deletedAt` / `deletedBy` columns AND is in `SOFT_DELETE_MODELS` (`lib/prisma/soft-delete-extension.ts`). When you add either, add the other in the same commit, or queries silently return deleted rows. `/scaffold-entity` does both in lockstep.
- **`prismaUnfiltered` exists for a reason.** Auth callbacks use it so they can see soft-deleted users for accurate "user not found vs deactivated" handling. Outside auth, use the default `prisma` export.
- **Parameterized SQL only.** No `SELECT *` in raw queries. No raw `UPDATE` / `DELETE` without a `WHERE`.
- **Validate at the API boundary with zod.** Schemas live in `lib/validations/`. Don't trust `req.json()` without parsing.
- **Naming:** snake_case tables (via `@@map`); camelCase Prisma fields and TS; PascalCase React components and Prisma models.

## Ask before
- Installing a runtime dependency that ships to the client bundle (anything > 50 KB minified needs justification)
- Touching `lib/auth.ts`, `middleware.ts`, `lib/prisma/audit-extension.ts`, `lib/prisma/soft-delete-extension.ts`, or anything in `prisma/migrations/`
- Adding a model to the audit `EXCLUDE` set
- Adding a new public path to `publicPaths` in `middleware.ts`
- Bypassing `withAuth` / `withAdminAuth` on an API route
- Changing the `Role` enum or how roles are checked
- Pushing to `main` directly — always branch + PR; `main` triggers the prod webhook
- Suppressing a lint / security-scan finding (record it in `SECURITY.md` §12 once scanners are wired)

## Commands
- `npm run dev` — Next.js dev server at `http://localhost:3000`
- `make setup` — first-time on a human-coder workstation: install deps, start `db` + `minio` + `minio-init` in Docker, generate Prisma client, migrate, seed. **Claude sessions:** the SessionStart hook handles deps + prisma generate; run `make db-up` only when you need the DB.
- `make db-up` / `make db-down` — start / stop just the dependency containers
- `npm run prisma:migrate` — create + apply a new migration in dev
- `npm run prisma:generate` — regenerate client after a schema change (run after every `git pull` that touches `schema.prisma`)
- `npm run prisma:seed` — re-run `prisma/seed.ts`
- `npm run prisma:studio` — open Prisma Studio at `http://localhost:5555`
- `npm run lint` — ESLint
- `git push origin main` — triggers `docker-build.yml` → builds, pushes to GHCR, hits the Portainer webhook
- `make docker-build` — build the production image locally (matches the CI build)

## Known traps (don't "fix")
- **Generated client lives in `generated/prisma`, not `node_modules/.prisma/client`.** Schema sets `output = "../generated/prisma"`. Imports in `lib/prisma/*` go through that path. Don't "fix" the import to `@prisma/client` — Prisma 7 with a custom output requires the relative path.
- **Auth.js uses JWT session strategy despite the Prisma adapter being wired.** Sessions are not stored in the `sessions` table at runtime — that table exists for OAuth account linking. Don't query `sessions` to enumerate active users.
- **`session.user.role` is typed as `any`.** Auth.js v5 module augmentation isn't set up yet. Always cast or guard; tracked as a low-severity follow-up in `SECURITY.md` §11.
- **`middleware.ts` runs on the Node.js runtime** (`export const runtime = "nodejs"`), not the Edge runtime — `lib/auth.ts` imports `bcryptjs` and `@prisma/adapter-pg`, neither of which run on the Edge.
- **`prismaUnfiltered` ≠ `prisma`.** The default export has the soft-delete extension; the unfiltered export does not. Auth.js callbacks need unfiltered access; everything else should use the filtered client or it'll see deleted rows.
- **`next-intl` locale matching strips the locale prefix.** Public-path matching in `middleware.ts` does this with a regex over `(en|ar)` — if you add a locale, update the regex.
- **MinIO presigned URLs default to 1 hour.** Don't ship long-lived URLs in emails, logs, or audit metadata.
- **`output: "standalone"` in `next.config.ts` is required for the Docker image to be small.** Removing it breaks the multi-stage build.
- **The Docker entrypoint runs `prisma migrate deploy` before starting the app.** A bad migration takes the whole container down — verify locally before pushing to `main`.
- **`docker-compose.prod.yml` pins the app image to `:latest`.** Rolling back means redeploying an older SHA tag; pin per-environment if you need stronger rollback guarantees.

When in doubt, stop and ask.
