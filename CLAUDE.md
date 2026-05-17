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
  - `/scaffold-entity <Name> --fields ... [--enums ...] [--relations ...]` — codegen for a new CRUD entity. Backed by `scripts/scaffold-entity.mjs`. Supports scalars, enums (rendered as Tag with filter), and FK relations (with auto-detected display field + back-ref patched into target).
  - `/ship` — local pre-commit verification (typecheck → lint → test → build). CI runs the same checks on every push.
  - `/adr <title>` — create a new Architecture Decision Record under `docs/decisions/` with the next zero-padded number.
  - `/first-fork` — one-time bootstrap checklist after forking the template (secrets, age keypair, rclone, Portainer stack with stack-webhook for SHA pinning, branch protection, first project ADR, SMTP if email is in scope).
  - `/rebrand <slug> <name> <owner>` — sweep the template's hardcoded defaults. Backed by `scripts/rebrand.mjs`.

All harness files are project-name-agnostic and survive forks unchanged.

## CI gates (no local action required)
Every push to a non-main branch and every PR triggers five workflows. Failures block merge once branch protection is on.

| Workflow | When | What |
|---|---|---|
| `verify.yml` | PR + push (non-main) | tsc + ESLint + `node:test` contract suite + Next build + npm audit high+ + scaffold smokes (scalars-only + enums+relations) |
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
- **Email:** nodemailer wrapper at `lib/email.ts` (`sendEmail`, `buildMailOptions`, `isEmailEnabled`). Gated by `SMTP_HOST`: when unset, `sendEmail` returns `{ sent: false }` and logs a warning — the app still runs. Configure during `/first-fork` step 9.
- **Validation:** `zod` (env parsing in `lib/env.ts`, per-route schemas in `lib/validations/`)
- **Edge:** none — Next.js serves directly on `:3000`. Put a TLS-terminating reverse proxy in front in production.
- **Backup:** encrypted off-host sidecar (`deploy/backup.sh` + `backup` service in `docker-compose.prod.yml`) using age + rclone. Gated by `BACKUP_ENABLED` (defaults off; flipped on by `/first-fork`).
- **Host (default):** Portainer-managed Docker host. CI pushes images to `ghcr.io/<owner>/<slug>`; Portainer stack webhook redeploys on push to `main`.

## Hard rules
- **Never commit `.env`.** `.env.example` is in git; real secrets are environment variables on the host or repo secrets. Auth, DB, MinIO, audit-purge, backup, and SMTP credentials are all Restricted — see `SECURITY.md` §1. gitleaks gates every push.
- **Never log** `AUTH_SECRET`, `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY` / `MINIO_ROOT_PASSWORD`, `SEED_ADMIN_PASSWORD`, `AUDIT_PURGE_TOKEN`, `BACKUP_AGE_IDENTITY`, `SMTP_PASSWORD`, any `passwordHash`, any presigned URL, or any session token / JWT. Full list in `SECURITY.md` §1.
- **Email bodies may carry Restricted content** (OTPs, password-reset tokens, presigned URLs, salary statements). `lib/email.ts` deliberately logs only metadata (messageId + to-summary + subject). **Never** add a separate `console.log(opts.text)` for debugging — if you need to verify a send, query the SMTP provider's audit log instead.
- **Adding a Restricted column?** Extend `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` AND its membership assertion in `tests/contracts/audit-scrub.test.ts` in the same commit. See `SECURITY.md` §5 + finding T-03.
- **Go through Prisma.** No raw SQL except via `prisma.$queryRaw` with parameter placeholders. Never `prisma.$executeRawUnsafe` on user input.
- **UI → API route → service → Prisma.** Server components and API routes are the only places that touch `prisma`. Client components call `/api/*`, never `prisma`.
- **Use the auth wrappers.** Every API route handler wraps with `withAuth`, `withAdminAuth`, or `withInternalAuth` from `lib/api-helpers.ts`. Bare handlers must justify it in the PR description.
- **Internal endpoints** (`/api/internal/*`) use `withInternalAuth(tokenEnv, ...)` and are gated by an `x-internal-token` header. They bypass session auth on purpose; only scheduled GHA workflows holding the matching secret should call them.
- **Audit is automatic but fragile.** `auditExtension` runs on every Prisma `create` / `update` / `delete` outside the EXCLUDE set (`AuditLog`, `Account`, `Session`, `VerificationToken`). Don't add new models to that EXCLUDE set without an ADR. Don't write to `audit_logs` directly.
- **Soft-delete is opt-in.** A model only participates if it has `deletedAt` / `deletedBy` columns AND is in `SOFT_DELETE_MODELS` (`lib/prisma/soft-delete-extension.ts`). `/scaffold-entity` does both in lockstep.
- **`prismaUnfiltered` exists for a reason.** Auth callbacks use it so they can see soft-deleted users for accurate "user not found vs deactivated" handling. Outside auth + the recycling bin, use the default `prisma` export.
- **Parameterized SQL only.** No `SELECT *` in raw queries. No raw `UPDATE` / `DELETE` without a `WHERE`.
- **Validate at the API boundary with zod.** Schemas live in `lib/validations/`. Don't trust `req.json()` without parsing.
- **Naming:** snake_case tables (via `@@map`); camelCase Prisma fields and TS; PascalCase React components and Prisma models.

## Ask before
- Installing a runtime dependency that ships to the client bundle (anything > 50 KB minified needs an ADR)
- Touching `lib/auth.ts`, `lib/rate-limit.ts`, `lib/email.ts`, `middleware.ts`, `lib/prisma/audit-extension.ts`, `lib/prisma/soft-delete-extension.ts`, or anything in `prisma/migrations/`
- Adding a model to the audit `EXCLUDE` set
- Adding a new public path to `publicPaths` in `middleware.ts` or a new `/api/internal/*` route
- Bypassing `withAuth` / `withAdminAuth` / `withInternalAuth` on an API route
- Changing the `Role` enum or how roles are checked
- Pushing to `main` directly — always branch + PR; `main` triggers the prod webhook
- Suppressing a Semgrep / gitleaks / npm-audit finding (record it in `SECURITY.md` §12)
- Changing the locked stack from ADR-001 — write a new ADR superseding the relevant section first

## Commands
- `npm run dev` — Next.js dev server at `http://localhost:3000`
- `npm run scaffold -- --name <Pascal> --fields '<spec>' [--enums '...'] [--relations '...']` — generate a new CRUD entity. See `.claude/skills/scaffold-entity/SKILL.md`.
- `npm run rebrand -- --slug <kebab> --name '<Display>' --owner <gh-owner>` — swap template defaults for fork identity.
- `npm test` — contract suite (rate limit, audit scrub, email) via `node:test`. CI runs this on every push.
- `npm run prisma:migrate` — create + apply a new migration in dev
- `npm run prisma:generate` — regenerate client after a schema change
- `npm run prisma:seed` — re-run `prisma/seed.ts`
- `npm run prisma:studio` — open Prisma Studio at `http://localhost:5555`
- `npm run lint` — ESLint
- `make db-up` / `make db-down` — start / stop just the dependency containers
- `make setup` — first-time on a human-coder workstation
- `git push origin main` — triggers `docker-build.yml` → builds, tags `:latest` + `:sha-<short>`, hits the Portainer webhook

## Sending email
```ts
import { sendEmail, isEmailEnabled } from "@/lib/email";

const result = await sendEmail({
  to: user.email,
  subject: "Your password reset link",
  text: `Open ${url} to reset your password. Expires in 1 hour.`,
  html: `<p>Open <a href="${url}">this link</a> to reset your password. Expires in 1 hour.</p>`,
});

if (!result.sent) {
  // SMTP_HOST unset -- decide per call site whether that's a fatal error.
  // For password reset: probably surface to admin ("email is not configured").
  // For best-effort notification: silently continue.
}
```

## Known traps (don't "fix")
- **Generated Prisma client lives in `generated/prisma`, not `node_modules/.prisma/client`.** Schema sets `output = "../generated/prisma"`.
- **Auth.js uses JWT session strategy despite the Prisma adapter being wired.** The `sessions` table is for OAuth account linking only.
- **`middleware.ts` runs on the Node.js runtime** (`export const runtime = "nodejs"`).
- **`prismaUnfiltered` ≠ `prisma`.** Soft-delete is on `prisma`, off on `prismaUnfiltered`.
- **`next-intl` locale matching strips the locale prefix.** Adding a locale means updating the regex in `middleware.ts`.
- **MinIO presigned URLs default to 1 hour.** Don't ship long-lived URLs in emails, logs, or audit metadata.
- **Rate limiter is in-memory and per-instance.** Fine for single-container Portainer; horizontally-scaled forks swap to `@upstash/ratelimit`.
- **`sendEmail` returns `{ sent: false }` when SMTP_HOST is unset.** It does NOT throw. Callers that require email to succeed must check `result.sent` and decide per-flow whether that's fatal.
- **CSP allows `'unsafe-inline'`** for script + style (Ant Design SSR + Next bootstrap). Future ADR.
- **`output: "standalone"` is required** for the small Docker image.
- **The Docker entrypoint runs `prisma migrate deploy`** before starting the app.
- **`docker-compose.prod.yml` resolves through `${IMAGE_TAG:-latest}`.** Use a Portainer **stack** webhook to honor the `?IMAGE_TAG=` query string and pin to SHA.
- **`BACKUP_ENABLED` defaults to `false`.** Flipped on by `/first-fork` step 6.
- **`AUDIT_PURGE_TOKEN` is optional.** Endpoint returns 503 if unset.
- **`/scaffold-entity` does not handle multiple relations from one source to the same target.** Prisma requires explicit `@relation("<Name>", ...)` for that case — hand-edit before running the migration.
- **`/scaffold-entity` includes do not filter target soft-deletes.** A known Prisma-extension limitation. Hand-edit the route to add a `where: { deletedAt: null }` on the include if needed.

When in doubt, stop and ask.
