# CLAUDE.md — Fullstack Next.js Template

Reusable starter for Rihal internal tools. Next.js 16 + Prisma 7 (Postgres) + Auth.js v5 + MinIO + Ant Design + next-intl. Deploys as a single Docker image to a Portainer-managed host via GHCR webhook. Owner: Tariq Al-Naaimi.

**This is the template.** When you fork it into a project, run `/rebrand` then `/first-fork` to swap defaults and bootstrap secrets / Portainer / branch protection. Sections below describe what the template ships out of the box — treat them as defaults to keep, tighten, or replace.

## Read before non-trivial work
- `@README.md` — stack overview, project structure
- `SECURITY.md` — data classes, secrets, threat model, findings T-01..T-09, CI gates §14 (read before touching auth / data / secrets / a finding)
- `docs/decisions/ADR-001-template-baseline.md` — the locked stack + invariants every fork inherits
- `prisma/schema.prisma` — the source of truth for the data model
- `lib/prisma/audit-extension.ts` + `lib/prisma/soft-delete-extension.ts` — invariants the rest of the codebase relies on

## Vibe-coding harness (`.claude/`)
This template is tuned for Claude Code sessions. Humans coding by hand can ignore `.claude/`; it does not affect the runtime build.

- **Permission allowlist** (`.claude/settings.json`) pre-approves the common loop — npm, prisma, docker compose, make, non-destructive git (including pushes to any branch). Force pushes, `rm -rf`, `git reset --hard`, `git commit --amend`, and branch deletes still prompt.
- **SessionStart hook** (`.claude/hooks/session-start.sh`) runs synchronously on session boot: copies `.env.example` → `.env` if missing, runs `npm install` if `node_modules` is missing, runs `prisma generate` if the client is missing. The hook does NOT start Docker containers — run `make db-up` once when you actually need the DB.
- **Skills** in `.claude/skills/`:
  - `/scaffold-entity <Name> --fields ...` — codegen for a new CRUD entity (model + zod + API routes + dashboard pages + sidebar + recycling-bin + soft-delete registry). Backed by `scripts/scaffold-entity.mjs`. Stops at file generation so you review the schema diff.
  - `/ship` — local pre-commit verification (typecheck → lint → build). CI runs the same checks on every push.
  - `/adr <title>` — create a new Architecture Decision Record under `docs/decisions/` with the next zero-padded number.
  - `/first-fork` — one-time bootstrap checklist after forking the template (secrets, age keypair, rclone, Portainer stack with stack-webhook for SHA pinning, branch protection, first project ADR).
  - `/rebrand <slug> <name> <owner>` — sweeps the template's hardcoded defaults (`package.json` name, GHCR image refs, container names, `NEXT_PUBLIC_APP_NAME`, CLAUDE.md first paragraph). Backed by `scripts/rebrand.mjs`.

All harness files are project-name-agnostic and survive forks unchanged.

## CI gates (no local action required)
Every push to a non-main branch and every PR triggers five workflows. Failures block merge once branch protection is on (configured in `/first-fork` step 10).

| Workflow | When | What |
|---|---|---|
| `verify.yml` | PR + push (non-main) | tsc + ESLint + `node:test` contract suite + Next build + npm audit high+ + scaffold smoke |
| `secrets-scan.yml` | PR + push (any) | gitleaks across full history |
| `sast.yml` | PR + push (any) | Semgrep with p/javascript, p/typescript, p/nextjs, p/react, p/owasp-top-ten, p/secrets |
| `audit-retention.yml` | Monthly cron + dispatch | POST to `/api/internal/audit-purge` with `AUDIT_PURGE_TOKEN` |
| `restore-test.yml` | Quarterly cron + dispatch | Decrypts newest backup, restores into ephemeral Postgres, asserts `users` non-empty |

Pushes to `main` go through `docker-build.yml` instead — it tags `:latest` + `:sha-<short>`, then calls the Portainer webhook with `?IMAGE_TAG=sha-<short>` for stack-webhook SHA pinning. See `SECURITY.md` §14.

## Stack
- **Framework:** Next.js 16 (App Router, `output: "standalone"`) · React 19 · TypeScript 5
- **UI:** Ant Design 6 + `@ant-design/nextjs-registry` · dark-mode toggle · RTL for `ar` locale
- **i18n:** `next-intl` 4 · locales `en`, `ar` · routing under `app/[locale]/`
- **ORM:** Prisma 7 + `@prisma/adapter-pg` · Postgres 17 · generated client at `generated/prisma`
- **Auth:** Auth.js v5 (`next-auth@beta`) · Credentials + bcryptjs · JWT session strategy · Google OAuth wired but commented out · 10/min/IP rate limit on `/api/auth/*` via `lib/rate-limit.ts`
- **Storage:** MinIO (S3-compatible) via `@aws-sdk/client-s3` + presigned URLs (`lib/storage.ts`)
- **Validation:** `zod` (env parsing in `lib/env.ts`, per-route schemas in `lib/validations/`)
- **Edge:** none — Next.js serves directly on `:3000`. Put a TLS-terminating reverse proxy in front in production.
- **Backup:** encrypted off-host sidecar (`deploy/backup.sh` + `backup` service in `docker-compose.prod.yml`) using age + rclone. Gated by `BACKUP_ENABLED` (defaults off; flipped on by `/first-fork`).
- **Host (default):** Portainer-managed Docker host. CI pushes images to `ghcr.io/<owner>/<slug>`; Portainer stack webhook redeploys on push to `main`.

## Hard rules
- **Never commit `.env`.** `.env.example` is in git; real secrets are environment variables on the host or repo secrets. Auth, DB, MinIO, audit-purge, and backup credentials are all Restricted — see `SECURITY.md` §1. gitleaks gates every push.
- **Never log** `AUTH_SECRET`, `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY` / `MINIO_ROOT_PASSWORD`, `SEED_ADMIN_PASSWORD`, `AUDIT_PURGE_TOKEN`, `BACKUP_AGE_IDENTITY`, any `passwordHash`, any presigned URL, or any session token / JWT. Full list in `SECURITY.md` §1.
- **Adding a Restricted column?** Extend `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` in the same commit, or the value leaks into `audit_logs.before`/`after`. See `SECURITY.md` §5 + finding T-03. The contract suite (`tests/contracts/audit-scrub.test.ts`) asserts the known set; add the new field to its membership check too.
- **Go through Prisma.** No raw SQL except via `prisma.$queryRaw` with parameter placeholders. Never `prisma.$executeRawUnsafe` on user input.
- **UI → API route → service → Prisma.** Server components and API routes are the only places that touch `prisma`. Client components call `/api/*`, never `prisma`.
- **Use the auth wrappers.** Every API route handler wraps with `withAuth`, `withAdminAuth`, or `withInternalAuth` from `lib/api-helpers.ts`. Bare handlers must justify it in the PR description. The wrappers seed the audit context (or the internal-token check) — bypassing them breaks audit attribution or auth.
- **Internal endpoints** (`/api/internal/*`) use `withInternalAuth(tokenEnv, ...)` and are gated by an `x-internal-token` header. They bypass session auth on purpose; only scheduled GHA workflows holding the matching secret should call them.
- **Audit is automatic but fragile.** `auditExtension` runs on every Prisma `create` / `update` / `delete` outside the EXCLUDE set (`AuditLog`, `Account`, `Session`, `VerificationToken`). Don't add new models to that EXCLUDE set without an ADR. Don't write to `audit_logs` directly — let the extension do it.
- **Soft-delete is opt-in.** A model only participates if it has `deletedAt` / `deletedBy` columns AND is in `SOFT_DELETE_MODELS` (`lib/prisma/soft-delete-extension.ts`). `/scaffold-entity` does both in lockstep; manual additions must do both in the same commit.
- **`prismaUnfiltered` exists for a reason.** Auth callbacks use it so they can see soft-deleted users for accurate "user not found vs deactivated" handling. Outside auth + the recycling bin, use the default `prisma` export.
- **Parameterized SQL only.** No `SELECT *` in raw queries. No raw `UPDATE` / `DELETE` without a `WHERE`.
- **Validate at the API boundary with zod.** Schemas live in `lib/validations/`. Don't trust `req.json()` without parsing.
- **Naming:** snake_case tables (via `@@map`); camelCase Prisma fields and TS; PascalCase React components and Prisma models.

## Ask before
- Installing a runtime dependency that ships to the client bundle (anything > 50 KB minified needs an ADR)
- Touching `lib/auth.ts`, `lib/rate-limit.ts`, `middleware.ts`, `lib/prisma/audit-extension.ts`, `lib/prisma/soft-delete-extension.ts`, or anything in `prisma/migrations/`
- Adding a model to the audit `EXCLUDE` set
- Adding a new public path to `publicPaths` in `middleware.ts` or a new `/api/internal/*` route
- Bypassing `withAuth` / `withAdminAuth` / `withInternalAuth` on an API route
- Changing the `Role` enum or how roles are checked
- Pushing to `main` directly — always branch + PR; `main` triggers the prod webhook
- Suppressing a Semgrep / gitleaks / npm-audit finding (record it in `SECURITY.md` §12 with rule ID, location, justification, and date)
- Changing the locked stack from ADR-001 — write a new ADR superseding the relevant section first

## Commands
- `npm run dev` — Next.js dev server at `http://localhost:3000`
- `npm run scaffold -- --name <Pascal> --fields '<spec>'` — generate a new CRUD entity. See `.claude/skills/scaffold-entity/SKILL.md`.
- `npm run rebrand -- --slug <kebab> --name '<Display>' --owner <gh-owner>` — swap template defaults for fork identity.
- `npm test` — contract suite (rate limit, audit scrub) via `node:test`. CI runs this on every push.
- `npm run prisma:migrate` — create + apply a new migration in dev
- `npm run prisma:generate` — regenerate client after a schema change
- `npm run prisma:seed` — re-run `prisma/seed.ts`
- `npm run prisma:studio` — open Prisma Studio at `http://localhost:5555`
- `npm run lint` — ESLint
- `make db-up` / `make db-down` — start / stop just the dependency containers
- `make setup` — first-time on a human-coder workstation
- `git push origin main` — triggers `docker-build.yml` → builds, tags `:latest` + `:sha-<short>`, hits the Portainer webhook with `?IMAGE_TAG=sha-<short>`

## Known traps (don't "fix")
- **Generated Prisma client lives in `generated/prisma`, not `node_modules/.prisma/client`.** Schema sets `output = "../generated/prisma"`. Imports in `lib/prisma/*` go through that path.
- **Auth.js uses JWT session strategy despite the Prisma adapter being wired.** Sessions are not stored in the `sessions` table at runtime — that table exists for OAuth account linking.
- **`middleware.ts` runs on the Node.js runtime** (`export const runtime = "nodejs"`) — `lib/auth.ts` imports `bcryptjs` and `@prisma/adapter-pg`, neither of which run on the Edge.
- **`prismaUnfiltered` ≠ `prisma`.** The default export has the soft-delete extension; the unfiltered export does not.
- **`next-intl` locale matching strips the locale prefix.** Public-path matching in `middleware.ts` does this with a regex over `(en|ar)` — if you add a locale, update the regex.
- **MinIO presigned URLs default to 1 hour.** Don't ship long-lived URLs in emails, logs, or audit metadata.
- **Rate limiter is in-memory and per-instance.** Fine for single-container Portainer deploys. Horizontally-scaled forks swap to `@upstash/ratelimit` or another shared-state backend.
- **CSP allows `'unsafe-inline'` on script-src and style-src.** Required by Next.js bootstrap + Ant Design SSR. Tightening to nonce-based is a future ADR.
- **`output: "standalone"` in `next.config.ts` is required for the Docker image to be small.** Removing it breaks the multi-stage build.
- **The Docker entrypoint runs `prisma migrate deploy` before starting the app.** A bad migration takes the whole container down — verify locally before pushing to `main`.
- **`docker-compose.prod.yml` resolves through `${IMAGE_TAG:-latest}`.** Use a Portainer **stack** webhook (not service webhook) to honor the `?IMAGE_TAG=` query string and pin to SHA. See `SECURITY.md` T-04.
- **`BACKUP_ENABLED` defaults to `false`.** A fresh stack does not run backups until `/first-fork` step 6 flips it on (after rclone + age are configured). This is by design — we don't want to error-loop on a fresh fork before the operator has wired up encryption.
- **`AUDIT_PURGE_TOKEN` is optional.** If unset, the endpoint returns 503 and the monthly workflow skips with a warning. Forks must set it before relying on retention.

When in doubt, stop and ask.
