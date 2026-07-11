# ADR-001 — Template baseline stack and invariants

**Status:** Accepted (partially superseded by ADR-006)
**Date:** 2026-05-17
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

> **2026-05-21 update — ADR-006 supersedes the following parts of this ADR:**
> `output: "standalone"` Docker baseline, GHCR / Portainer CI/CD line, MinIO baseline, and the "Vercel deployment was rejected" alternative. The remaining invariants (Prisma extensions, Auth.js wrappers, audit scrubbing, soft-delete, security headers, rate limiter) are unchanged.
>
> The **"Verification automation" section below is historical** and is NOT covered by the supersession line above. Its "five workflows" list still names the deleted `audit-retention.yml` and `restore-test.yml` (removed with the on-host backup/cron infra in ADR-006) and the Docker "Image tag pinning" invariant no longer applies. The live CI surface is `verify.yml`, `secrets-scan.yml`, `sast.yml` (+ `codeql.yml`, `uat.yml`); audit purge now runs via Vercel Cron (see CLAUDE.md). Treat that section as a record of the original baseline, not the current state.

## Context

This is the inaugural ADR for the `fullstack-vibe-template` repo. Future projects fork this template and inherit a set of stack choices and code-level invariants that are framework-enforced (Prisma extensions, middleware, Auth.js callbacks). Forks need a single document that records _why_ those choices are what they are, so subsequent ADRs can argue against specific pieces without re-litigating the whole stack.

The template is optimized for Claude Code ("vibe coding") sessions: speed-to-first-deploy is the primary goal, fork ergonomics second. Speed wins over flexibility when they conflict.

## Decision

The template ships with the following stack and invariants. Forks change them only by raising a new ADR that supersedes the relevant section.

### Stack

- **Framework:** Next.js 16 App Router · React 19 · TypeScript 5 strict
- **Build output:** `output: "standalone"` for small Docker images
- **ORM:** Prisma 7 with `@prisma/adapter-pg` against Postgres 17
- **Auth:** Auth.js v5 (`next-auth@beta`) Credentials provider with bcryptjs, JWT session strategy
- **Storage:** MinIO (S3-compatible) via `@aws-sdk/client-s3` with presigned URLs
- **UI:** Ant Design 6 + `@ant-design/nextjs-registry`
- **i18n:** `next-intl` 4, locales `en` + `ar` (RTL on `ar`)
- **Validation:** `zod` 3 at API boundaries
- **CI/CD:** GitHub Actions → GHCR → Portainer webhook

### Framework-enforced invariants

- **Audit auto-write:** every Prisma `create` / `update` / `delete` outside the EXCLUDE set (`AuditLog`, `Account`, `Session`, `VerificationToken`) writes a row to `audit_logs` via the extension in `lib/prisma/audit-extension.ts`.
- **Restricted-field scrubbing:** `SCRUB_FIELDS` in the audit extension redacts values for `passwordHash`, `password`, `refresh_token`, `access_token`, `id_token`, `session_state`, `sessionToken`, `token`, `secret`, `apiKey`, `api_key` before write. Adding a Restricted column requires extending the set in the same commit.
- **Soft-delete:** opt-in via `SOFT_DELETE_MODELS` set in `lib/prisma/soft-delete-extension.ts`. Models in the set get `deletedAt`/`deletedBy` filtering on read and have `delete` rewritten as `update { deletedAt: now }`.
- **API boundary:** every route handler wraps with `withAuth` or `withAdminAuth` from `lib/api-helpers.ts`. Internal endpoints (audit purge, etc.) wrap with `withInternalAuth(tokenEnv, ...)`.
- **Rate limit:** 10/min/IP on `/api/auth/*` via in-memory token bucket (`lib/rate-limit.ts`). Horizontally-scaled forks swap to `@upstash/ratelimit`.
- **Security headers:** CSP + HSTS + X-Frame-Options + Referrer-Policy + Permissions-Policy emitted by `next.config.ts` on every response. CSP includes `'unsafe-inline'` for Ant Design SSR compatibility.
- **Image tag pinning:** `docker-compose.prod.yml` resolves through `${IMAGE_TAG:-latest}`; CI passes `?IMAGE_TAG=sha-<short>` on the Portainer webhook so stack webhooks pin to the build SHA.

### Verification automation

Every push to a non-main branch and every PR runs five workflows (none require local execution):

- `verify.yml` — `tsc --noEmit` + ESLint + `node:test` contract suite + `next build` + `npm audit --audit-level=high --omit=dev` + scaffold smoke test.
- `secrets-scan.yml` — gitleaks across full git history.
- `sast.yml` — Semgrep with `p/javascript`, `p/typescript`, `p/nextjs`, `p/react`, `p/owasp-top-ten`, `p/secrets`.
- `audit-retention.yml` — monthly cron POST to `/api/internal/audit-purge`.
- `restore-test.yml` — quarterly cron decrypting the newest backup into an ephemeral Postgres and asserting `users` is non-empty.

## Consequences

### Positive

- Fresh fork ships with audit + soft-delete + RBAC + rate-limit + CSP + encrypted off-host backups + retention policy on day zero. No bespoke security plumbing per project.
- Vibe-coding velocity: `/scaffold-entity` produces a working CRUD slice in seconds; `/ship` (or CI) verifies before push; `/first-fork` walks the operator through the one-time setup.
- Threat model is documented once in `SECURITY.md` and inherited by every fork. Restricted-class fields are framework-protected from audit-log leakage.

### Negative

- Opinionated stack: forks needing a different DB / auth provider / UI library pay a porting cost (or supersede this ADR).
- Ant Design's CSS-in-JS forces `'unsafe-inline'` on `style-src` and on `script-src` for the Next.js bootstrap inline script. Nonce-based CSP is a future ADR.
- In-memory rate limiter is per-instance — horizontally scaled deploys need a shared-state limiter (documented but not auto-installed).
- No MFA out of the box (finding T-02). Forks needing MFA wire WebAuthn / TOTP or front with an SSO provider.

### Mitigations

- The codegen + skills (`/scaffold-entity`, `/ship`, `/first-fork`, `/rebrand`, `/adr`) keep the opinionated parts cheap to live with.
- CI catches stack drift early: any commit that violates the invariants (e.g. raw SQL, missing audit context, removed CSP) fails Semgrep / typecheck / contract suite.

## Alternatives considered

1. **Drizzle ORM** instead of Prisma. Rejected: Prisma 7's extensions are the cleanest hook point for framework-enforced audit + soft-delete. Drizzle would require hand-rolled middleware on every query call site.
2. **Clerk / Supabase Auth** instead of Auth.js. Rejected: external auth adds an outbound dependency and a per-project signup cost. Auth.js Credentials with bcryptjs hashes is sufficient for the internal-tool use case the template targets.
3. **Tailwind + shadcn/ui** instead of Ant Design. Rejected: Ant Design ships a complete admin-UI vocabulary (DataTable, Form, ConfirmAction) out of the box. shadcn requires more glue per entity.
4. **Vercel deployment** instead of Portainer / GHCR. Rejected: the template's audience (Rihal internal tools) is on-prem-friendly hosting; Vercel binds to a vendor and complicates internal-network access.
5. **Vitest** instead of `node:test`. Rejected: `node:test` is built-in and adds zero devDeps, which keeps `package-lock.json` simpler to manage when forks are created via Claude (no local install loop required).

## Migration triggers

Revisit this ADR (or sub-decisions within it) on:

- Need for horizontal scaling beyond one app container (rate limiter, audit attribution).
- Salary / health / other Tier-3 data added to a fork (Restricted-class growth; may need column encryption ADR).
- Ant Design 7 release (CSP `'unsafe-inline'` removal opportunity).
- Need for MFA (closes finding T-02).
- Need for non-S3-compatible backup targets (replace rclone abstraction).

## Related

- `CLAUDE.md` — hard rules + harness
- `SECURITY.md` — threat model, findings T-01..T-09, CI gates
- `docs/decisions/ADR-TEMPLATE.md` — format for subsequent ADRs
