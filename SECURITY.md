# SECURITY — Fullstack Next.js Template

Template-level security baseline. **When you fork this into a project, this file is load-bearing:** every change that touches auth, roles, data classification, encryption, audit, secrets, retention, or external network calls updates this file in the same commit. The sections below describe what the template ships out of the box; downstream projects must replace placeholders, fill in data classes for the actual entities they store, and re-run the threat model on first commit.

**This template is unclassified.** It contains no real data and is not a deployment. Tier and PDPL posture are set per project — see §9.

> **This file reflects the Vercel + Neon reality** (ADR-006) as of the solo-rail optimization (ADR-007). The self-hosted machinery — Droplet, Portainer, GHCR, Caddy, MinIO, the age/rclone backup sidecar, and the deploy/rollback/restore/audit-retention workflows — was removed and no longer ships. The **data-classification rules, audit-scrubbing invariants, hard rules, and threat-model categories remain authoritative**; only the deploy plumbing changed. Forks that need operator-managed encryption keys, encrypted off-host backups, or self-hosted infra do not belong on this template — they belong on the IT team's stack from day zero.

---

## 1. Data classification

Every field carries one of four labels. Drives encryption, access, logging, retention. The template only ships the auth-and-audit surface; project-owned models inherit this framework.

| Class | Definition | Examples in the template |
|---|---|---|
| **Public** | No harm if disclosed | Static assets in `public/`, i18n message files in `messages/`, Sentry DSN |
| **Internal** | No individual harm if leaked | `audit_logs.action`, `audit_logs.entityType`, role definitions (`Role` enum), seed fixtures, `AUDIT_RETENTION_DAYS`, `RECYCLE_BIN_RETENTION_DAYS` |
| **Confidential** | Disclosure harms individuals / contracts / competitive position | `users.email`, `users.name`, `users.image`, `users.lastLoginAt`, `audit_logs.before` / `after` / `changes` JSON blobs (they snapshot whatever entity you write — if the entity holds Confidential fields, the audit row inherits the label), `audit_logs.ipAddress`, `audit_logs.userAgent`, `DATABASE_URL` (embeds the Neon credential) |
| **Restricted** | Significant harm or legal liability | `AUTH_SECRET`, `SEED_ADMIN_PASSWORD`, `AUDIT_PURGE_TOKEN`, `CRON_SECRET`, `users.passwordHash` (bcryptjs — irreversible but still secret-equivalent if exfiltrated), Auth.js JWT cookies in transit, `accounts.refresh_token` / `access_token` / `id_token`, `AUTH_GOOGLE_SECRET` if OAuth is enabled, `SMTP_PASSWORD` if email is enabled |

**Operational rules per class:**

- **Restricted:** never logged, never returned by an API outside the owning user's own session, never in default exports. `audit_logs.before` / `after` automatically scrub Restricted field values via `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` (see §5). Excel export is a **separate** gate (`SCRUB_FIELDS` does not touch export output): `rihal-template/no-restricted-export-column` fails `/ship` at `error` when a secret-named field is used as a `toExcel` column key, so a fork can't dump a Restricted column into a downloadable `.xlsx` (its denylist is kept a superset of `SCRUB_FIELDS` by `tests/contracts/export-column-completeness.test.ts`).
- **Confidential:** auth + role gate at the API boundary. Logged on sensitive read where the project defines one (the template doesn't ship read-side audit — write-side only).
- **Internal:** auth + role gate.
- **Public:** can appear unauthenticated.

**Downstream projects:** when introducing a new Restricted field, (1) add a row above and (2) extend `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` and `tests/contracts/audit-scrub.test.ts` in the same commit.

---

## 2. Authentication — current

🟢 **Auth.js v5 (next-auth beta) with Credentials provider, JWT session strategy.** Configuration lives in `lib/auth.ts`. Sign-in page: `/login` (per-locale). Middleware (`middleware.ts`) gates every non-public path and returns `401` on unauthenticated API calls.

- **Password hashing:** `bcryptjs.compare` against `users.passwordHash`. Seed hashes use the bcryptjs default cost factor; any project-introduced reset endpoint must use the same library. **Never** MD5 / SHA1 / raw SHA256 / plain PBKDF2.
- **Session payload:** JWT only. Carries `{id, role}` on the `token` and exposes them on `session.user` (typed via `types/index.ts`). The `sessions` table exists because the Prisma adapter is wired (needed for OAuth account linking), but JWT sessions are not written there.
- **SSO / OAuth (ADR-024):** Microsoft Entra ID is wired into `lib/auth.ts` and is **dormant until both `AUTH_MICROSOFT_ENTRA_ID_ID` and `AUTH_MICROSOFT_ENTRA_ID_SECRET` are set** (then a "Sign in with Microsoft" button appears). `AUTH_ENFORCE_SSO=true` removes the credentials provider entirely so Entra (and its MFA) is the only way in — this closes T-02 for that deployment. New SSO users default to `HIRING_MANAGER` (`mapSsoRole`, least privilege); an HR_ADMIN promotes them in-app. `allowDangerousEmailAccountLinking` is OFF, so an Entra email matching an existing password user is not auto-linked (anti-takeover). A Google stub remains commented for forks that want it. **Operational notes (ADR-024):** (1) Activation requires id + secret + **issuer** — issuer is mandatory so the provider can't silently fall back to the any-tenant `common` endpoint. (2) A `signIn` callback blocks **new** sign-ins by soft-deleted SSO users (the adapter path doesn't filter `deletedAt` like the credentials path does); an already-issued JWT still persists until `maxAge` — rotate `AUTH_SECRET` to revoke immediately (same accepted gap as credentials). (3) If an SSO user's email matches a **soft-deleted** credentials user, Auth.js returns `OAuthAccountNotLinked` and the SSO user is blocked until an admin **permanently** deletes the old account from the recycling bin.
- **Public paths** (no session auth required) are listed in `middleware.ts`: `/login`, `/api/auth/*`, `/api/health`, `/api/internal/*`. Internal routes are gated by a shared secret via `withInternalAuth(tokenEnv, ...)`: the `x-internal-token` header, plus -- only on routes that opt in with `{ bearer: true }` -- `Authorization: Bearer` (needed by Vercel Cron, which cannot send custom headers; ADR-018). `x-internal-token`, when present, is authoritative. Internal routes compose `withRateLimit` so secret-guessing is throttled.
- **`prismaUnfiltered` in the authorize callback** is intentional — it sees soft-deleted users so the callback can distinguish "no such email" from "deactivated user" without leaking which. The `where` clause still filters `deletedAt: null` so deleted users cannot log in.
- **`next-auth@5` is a beta release sitting directly in the auth path.** Pin the exact version and review the release notes before upgrading — a breaking change here lands on the security boundary.

**Brute-force defense:** 🟢 **In-memory token bucket in `lib/rate-limit.ts`, applied to POST on `/api/auth/*` at 10/min/IP.** Returns 429 with `Retry-After` when exceeded. Horizontally-scaled forks MUST swap to a shared-state limiter (e.g. `@upstash/ratelimit` backed by Redis or Upstash). The contract suite (`tests/contracts/rate-limit.test.ts`) asserts the bucket semantics on every push.

**Account lifecycle:** seeding creates one admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Downstream projects MUST rotate `SEED_ADMIN_PASSWORD` on first login or remove the seed call from the entrypoint after initial deploy.

---

## 3. Authorization — current

🟢 Two-role enum: `HR_ADMIN` / `HIRING_MANAGER` (`prisma/schema.prisma` `Role`). Bound to `users.role`; the JWT carries it. The DB default is the least-privilege `HIRING_MANAGER`.

- **Boundary checks:** every API route handler wraps with `withAuth` (any authenticated user) or `withAdminAuth` (HR_ADMIN only) or `withManagerAuth` (HR_ADMIN **or** HIRING_MANAGER) or `withInternalAuth` (shared-secret) or `withApiAuth` (Bearer-token gate for machine/API consumers; the `/api/v1` seam) from `lib/api-helpers.ts`. UI gating is defense-in-depth, **not** the boundary.
- **Role wrappers:** `withAdminAuth` (HR_ADMIN only) and `withManagerAuth` (HR_ADMIN **or** HIRING_MANAGER; rejects any future/unknown role) are both shipped in `lib/api-helpers.ts`. Use `withManagerAuth` on routes both staff roles should reach; `withAdminAuth` on the admin-only surfaces (role profiles, invites, calibration, settings, audit). The rejection branch of `withManagerAuth` is locked by a contract test. Finer-grained, per-resource permissions (a `can()` helper) remain a project-specific addition documented here.
- **CSRF:** state-changing routes are same-origin + cookie-based; Auth.js sets `SameSite=Lax` session cookies, which blocks cross-site form/`fetch` POSTs from carrying the session. Custom POST/PUT/DELETE routes rely on this (no separate CSRF token). If a fork adds cross-origin browser clients or relaxes `SameSite`, add explicit CSRF protection (double-submit token or origin check) and note it here.
- **Tenant (org) scoping** is enforced in app code (not Postgres RLS): every list/get/update/delete that reads a tenant-owned row adds `orgId: session.user.orgId` to its `where` (see `/api/users`, `/api/users/[id]`, `/api/audit-log`). Audit rows are stamped with `orgId` at write time (`lib/prisma/audit-extension.ts` via `AuditContext`) and the audit-log read filters by it. A new tenant-owned route MUST follow this pattern — an un-scoped `findUnique({ where: { id } })` is a cross-tenant disclosure (the senior-review 2026-06-27 HIGH class). Postgres RLS is not enabled by default.
- **User directory + recycling bin are ADMIN-only.** `GET /api/users`, `GET /api/users/[id]`, and `GET /api/recycling-bin` wrap with `withAdminAuth` — a HIRING_MANAGER cannot read the user directory (`email` / `role` / `lastLoginAt`) or the recycling bin (which lists soft-deleted records incl. deleted-user PII + who deleted them). The matching nav entries are hidden for non-admins (`components/layout/AppSidebar.tsx`). A fork that *wants* a team-visible directory can relax these to `withAuth` (and unhide the nav) — note the change here.
- **`session.user.role`** is typed as `Role` via the augmentation in `types/index.ts`; callbacks in `lib/auth.ts` are cast-free.

---

## 4. Encryption — current

| Layer | State |
|---|---|
| TLS in transit | 🟢 **Vercel terminates TLS automatically** for every `*.vercel.app` deployment and for custom domains added through the Vercel UI. No reverse proxy to manage. HSTS header is emitted by `next.config.ts` regardless. |
| Disk encryption | Neon encrypts data at rest on its managed Postgres. The app itself is stateless on Vercel. |
| Column encryption of Restricted fields | ⚠️ **None.** `passwordHash` is bcrypt-hashed (irreversible by design). If a downstream project introduces Restricted columns (salaries, API tokens), add pgcrypto or app-layer AES-256-GCM and a row here. |
| Secrets in code | ✅ None. All in Vercel project env vars (prod) or local `.env` (gitignored). `.env.example` is in git; `.env` is in `.gitignore`. Enforced by gitleaks — run locally via `/ship` (and by `secrets-scan.yml` once CI is active at handoff). |
| Password hashing | ✅ bcryptjs only (`lib/auth.ts`). Default cost factor. **Never** MD5 / SHA1 / raw SHA256 / plain PBKDF2. |
| Auth.js JWT signing | ✅ `AUTH_SECRET` (Restricted). Rotation invalidates every session. |

**Default security headers:** the static ones (X-Frame-Options: DENY — matches the CSP `frame-ancestors 'none'`, the app is never framed; X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy, Strict-Transport-Security) are emitted by `next.config.ts`. **Content-Security-Policy is built per-request in `middleware.ts`** (a static header can't carry a nonce). `script-src` is **nonce-based** (`'self' 'nonce-<per-request>' 'strict-dynamic'`) — `'unsafe-inline'` is removed. Middleware sets the CSP (with the nonce) on both the request and response headers; Next.js reads the nonce from the request CSP header and auto-applies it to the scripts it emits, and the inline theme script in `app/[locale]/layout.tsx` carries it explicitly. `'unsafe-eval'` is added only in dev for HMR. `style-src` still allows `'unsafe-inline'` for Ant Design 6 emotion **inline `style="..."` attributes** a nonce cannot cover (revisit at AntD 7, ADR-001 trigger) — so AntD's stock SSR registry needs no nonce. The Sentry ingest origin is added to `connect-src` when `NEXT_PUBLIC_SENTRY_DSN` is set. See finding T-05 and recipe `shared-security/3-nonce-csp`.

**Backups:** managed by Neon. The free tier has none; Neon Launch ($19/mo) adds point-in-time recovery up to 7 days. Choosing and configuring a backup tier is a per-project / IT-team decision — there is no template-managed backup pipeline anymore (removed in ADR-006).

---

## 5. Audit logging — current

🟢 **Schema + writer ship with the template** (`prisma/schema.prisma` `AuditLog` + `lib/prisma/audit-extension.ts`). The Prisma extension auto-records every `create` / `update` / `delete` on every model **outside the EXCLUDE set** (`AuditLog`, `Account`, `Session`, `VerificationToken`).

- **Captured per row:** `timestamp`, `entityType`, `entityId`, `action` (`CREATE` / `UPDATE` / `DELETE` / `RESTORE`), `before` (JSON snapshot pre-write, scrubbed), `after` (JSON snapshot post-write, scrubbed), `changes` (diff with `updatedAt` excluded; scrubbed fields show as `from: [redacted], to: [redacted]`), `userId` (from `AuditContext`), `ipAddress`, `userAgent`.
- **Soft-delete coverage:** `prisma.<model>.delete()` is rewritten to a soft-delete by the soft-delete extension, which is the *outermost* hook and so bypasses the audit extension — it therefore writes its own `action: "DELETE"` audit row (with `deletedBy` set from the context). Recycling-bin **restore** and **permanent delete** go through `prismaUnfiltered` (outside the extension) and write explicit `RESTORE` / `DELETE` rows via `recordAudit()`. Password changes go through the audited client (`passwordHash` scrubbed). Net: create / update / soft-delete / restore / permanent-delete are all audited.
- **Attribution comes from `AuditContext`** seeded by `withAuth` / `withAdminAuth`, which now captures `userId`, `ipAddress` (`x-forwarded-for` / `x-real-ip`), and `userAgent`. Calls outside the wrappers (`withInternalAuth` endpoints, cron jobs, seed scripts) attribute to `null` user.
- **Bulk-write / upsert blind spot (not auto-audited):** the extension hooks only per-row `create` / `update` / `delete`. `prisma.<model>.updateMany(...)`, `createMany(...)`, and `upsert(...)` on an audited model write **no audit row** — Prisma does not decompose `upsert` into a `create`/`update` the extension can observe, so it is the same class of gap. A fork doing bulk or upsert writes must avoid them (loop per-row through the audited client) or write an explicit `recordAudit()` row alongside the op. The `rihal-template/no-unaudited-bulk-write` ESLint rule (at `error`) enforces this: it fails `/ship` on `prisma`/`prismaUnfiltered` `updateMany`/`createMany`/`deleteMany`/`upsert` against an audited model, so the blind spot can't be reintroduced silently (EXCLUDE-set models and `tests/`/`scripts/` are exempt). See ADR-010.
- **Non-atomicity (accepted limitation):** the audit row is written as a *separate* statement after the data write, not in the same transaction (Prisma query extensions can't wrap the underlying op + the audit insert atomically without a base-client restructure that would risk the soft-delete/audit invariants). A failed audit insert after a committed write is therefore possible. For prototype scale this is accepted; a `shared`-tier project that needs guaranteed atomicity should move to DB-trigger-based audit (future ADR). See ADR-010.
- **Restricted-field scrubbing:** `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` replaces values for `passwordHash`, `password`, `refresh_token`, `access_token`, `id_token`, `session_state`, `sessionToken`, `token`, `secret`, `apiKey`, `api_key`. The contract suite (`tests/contracts/audit-scrub.test.ts`) asserts the membership and behavior.
- **Retention:** scheduled via Vercel Cron (ADR-018). `vercel.json` ships a daily cron that GETs `app/api/internal/audit-purge`, which deletes rows older than `AUDIT_RETENTION_DAYS` (default 365) in capped batches. The cron authenticates with `Authorization: Bearer $CRON_SECRET` (Vercel injects it); until `CRON_SECRET` is set the run is a silent 200 no-op (`{skipped:true}`). Manual / Actions callers POST with `x-internal-token: $AUDIT_PURGE_TOKEN`. `/deploy` provisions `CRON_SECRET` automatically; manually-connected forks must set it themselves. See finding T-06 (closed).
- **Append-only:** enforced at the application layer. No DB-level `REVOKE` is set.

---

## 6. Secrets

Production secrets live in **Vercel project environment variables** (set in the Vercel UI per project). They never traverse Claude chat or the operator's shell. Local development reads them from `.env` (gitignored); `.env.example` documents the shape.

| Secret | Class | Where | Notes |
|---|---|---|---|
| `AUTH_SECRET` | Restricted | Vercel env / `.env` | JWT signing key. Rotation invalidates every session. `openssl rand -base64 32`. |
| `DATABASE_URL` | Confidential | Vercel env / `.env` | Embeds the Neon role password. Don't log the URL; rotate by rotating the Neon role. |
| `SEED_ADMIN_PASSWORD` | Restricted | Vercel env / `.env` | One-shot bootstrap. Rotate on first login or remove the seed call after initial deploy. |
| `AUDIT_PURGE_TOKEN` | Restricted (optional) | Vercel env / `.env` | Gates POSTs to `/api/internal/audit-purge` (`x-internal-token`). 503 if unset. `openssl rand -base64 48`. |
| `CRON_SECRET` | Restricted (optional) | Vercel env / `.env` | Gates the daily Vercel Cron GET to `/api/internal/audit-purge` (Vercel auto-sends it as `Authorization: Bearer`). Cron no-ops (200 skip) if unset. min 32 chars (zod-enforced). `openssl rand -base64 48`. |
| `SCORING_SERVICE_URL` | Internal (optional) | Vercel env / `.env` | Base URL of the deterministic scoring microservice (services/scoring; ADR-029). Dormant until set. Not a secret, but an internal hostname — don't expose publicly. |
| `SCORING_SERVICE_TOKEN` | Restricted (optional) | Vercel env / `.env` | Bearer token the Next app sends to the scoring service; must match the service's. The only auth on a network-reachable scorer. min 32 chars (zod-enforced). `openssl rand -base64 48`. |
| `LLM_ENDPOINT_URL` | Internal (optional) | Vercel env / `.env` | OpenAI-compatible base URL of the self-hosted LLM gateway (LiteLLM; ARCHITECTURE §4/§10). Dormant until set (gates AI drafting). NEVER a public API. Internal hostname — don't expose publicly. |
| `LLM_ENDPOINT_TOKEN` | Restricted (optional) | Vercel env / `.env` | Bearer token the Next app sends to the LLM gateway. The only auth on a network-reachable model gateway. min 32 chars (zod-enforced). `openssl rand -base64 48`. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Restricted (only if OAuth enabled) | Vercel env / `.env` | Rotate from Google Cloud Console. |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Restricted (only if SSO enabled) | Vercel env / `.env` | Entra app registration (ADR-024). Setting **both** id and secret turns SSO on (a half-set config stays dormant). Rotate the client secret from the Entra portal. Redirect URI: `{AUTH_URL}/api/auth/callback/microsoft-entra-id`. |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | Confidential (only if SSO enabled) | Vercel env / `.env` | Tenant-scoped issuer `https://login.microsoftonline.com/<tenant>/v2.0`. Not secret, but identifies the tenant. |
| `AUTH_ENFORCE_SSO` | Internal (flag) | Vercel env / `.env` | `"true"` removes the credentials provider entirely (SSO-only) so Entra MFA is mandatory — closes T-02. Default (unset) offers both. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | `SMTP_PASSWORD` Restricted; rest Confidential | Vercel env / `.env` | Optional. `lib/email.ts` is gated by `SMTP_HOST`; unset → `sendEmail` returns `{ sent: false }`. Never log `opts.text` / `opts.html`. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Public | Vercel env / `.env` | Public-by-design — Sentry DSNs ship in client bundles. **Not** Restricted. See ADR-002. |
| `SENTRY_AUTH_TOKEN` | Restricted | Vercel env (build) | Optional. Uploads source-maps at build time. Scope: `project:releases` + `org:read`. Missing → upload skips; app still runs. See ADR-002. |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_ENVIRONMENT` | Public | Vercel env / `.env` | Org / project slugs + environment label. Not secret. |

**CI-provisioning secrets (dormant on the free plan).** The `/new-project` GitHub Actions workflow (`new-project.yml`) — which cannot run until GitHub Actions billing is restored, see ADR-007 / Phase 6 — uses three repo-level secrets when active: `VERCEL_TOKEN`, `NEON_API_KEY`, and `CLOUDFLARE_API_TOKEN` (scoped to `Zone.DNS:Edit` on one zone, for the optional custom-domain CNAME). All Restricted. They live only as GitHub repo secrets, never operator-side. They are irrelevant to a fork that on-ramps via the manual `/first-fork`.

**Rotation log:** (downstream projects record every rotation event here)

| Date | Secret | Reason | Operator |
|---|---|---|---|
| — | — | — | — |

Rotate any secret after any chat-history-with-secret event. Rotating must never require a code change.

`.env.example` lives in git. `.env` never does. ✅ (enforced by gitleaks via `/ship`)

---

## 7. Threat model — top 5

Template-level baseline. Re-run per project on: scope expansion, new external integration, new dependency > 50 KB, host provider change, role enum change.

### T1 — Stolen credential
- **Who:** anyone with access to a user's mailbox or password manager
- **Vector:** phishing; password reuse from another breach; insider sharing
- **Blast:** full session at the user's role. ADMIN can mint users + change roles.
- **Control:** bcryptjs hashes ✅; JWT signed with `AUTH_SECRET` ✅; audit log of every write (with passwordHash scrubbed) ✅; soft-delete-aware login ✅; **10/min/IP rate limit on `/api/auth/*` ✅**. **No MFA** — see **T-02**.

### T2 — Audit-log snapshot leak
- **Status:** Mitigated by `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts`. Contract suite asserts redaction on every push.

### T3 — Presigned upload-URL leak
- **Status:** N/A by default — the template ships no file uploads. **Only relevant if `/scale-up` adds Vercel Blob.** When it does: keep upload URLs short-lived, never log them, and never let them land in audit metadata. Revisit this entry the moment uploads are wired.

### T4 — Vercel/Neon account compromise
- **Who:** anyone who phishes or hijacks the operator's Vercel or Neon login.
- **Blast:** Vercel → can read every project env var (`AUTH_SECRET`, `DATABASE_URL`, etc.), redeploy arbitrary code, change domains. Neon → full read/write of the database, including every `passwordHash` and audit row.
- **Control:** **enable MFA on both the Vercel and the Neon account.** Rotate `AUTH_SECRET` and the Neon role credential on any suspected compromise. Use a dedicated, isolated account for project ops, not a shared personal login.

### T5 — Dependency / supply-chain compromise
- **Who:** a malicious or compromised npm package in the tree.
- **Blast:** arbitrary code in the build or runtime.
- **Control:** `npm audit --audit-level=high --omit=dev` and gitleaks run locally via `/ship` on every push ✅; Semgrep (`p/owasp-top-ten`, `p/secrets`, …) via `/audit` on demand ✅; pin `next-auth@5` (beta) and review release notes before bumping (§2). CI mirrors these once active at handoff.

---

## 8. Incident response

Project-specific. Template stub for the Vercel + Neon stack:

1. **Rotate the suspected secret in the Vercel project env** (e.g. regenerate `AUTH_SECRET`; this invalidates every session).
2. **Revoke / rotate the Neon role** behind `DATABASE_URL` — reset the password or create a fresh role and retire the old one.
3. **Take the deployment offline via Vercel** if active exploitation is suspected (disable the deployment / remove the domain / roll back to a known-good deployment in the Vercel UI).
4. **Page the project owner.** Record the timeline and the rotations performed in the §6 rotation log.

Filled in per fork with real contacts and escalation paths.

---

## 9. Compliance baseline

Project-specific. The template is unclassified. PDPL / GDPR / sector-specific posture documented in the fork's first project ADR.

- **`shared`-tier projects** (flow to an IT handoff, may carry Omani PDPL or contractual obligations): fill in the compliance posture here before sharing externally.
- **`personal`-tier projects** (never shared with the company, no handoff): have no external compliance surface — this section can stay as the template stub. See the tier switch documented in `CLAUDE.md` (ADR-007 / Phase 8).

---

## 10. OWASP Top 10 — template coverage

| Risk | Coverage |
|---|---|
| A01 Broken Access Control | `withAuth` / `withAdminAuth` / `withInternalAuth` / `withApiAuth` (Bearer-token gate for machine/API consumers; the `/api/v1` seam) boundary ✅; middleware enforces auth on every non-public path ✅; `rihal-template/no-prisma-unfiltered-import` allowlists the soft-delete/audit-bypassing `prismaUnfiltered` client to auth/recycling-bin/maintenance files at `error` ✅. |
| A02 Cryptographic Failures | TLS terminated automatically at Vercel ✅; HSTS ✅; bcryptjs ✅; Neon encrypts at rest ✅. Production secrets live in Vercel env vars (never in chat / shell). |
| A03 Injection | Prisma parameterizes everything ✅; zod at boundary ✅; `rihal-template/no-raw-sql-unsafe` bans `$queryRawUnsafe`/`$executeRawUnsafe` at `error` ✅; Semgrep `p/owasp-top-ten` via `/audit` ✅. |
| A04 Insecure Design | Audit + soft-delete + scrubbing framework-enforced ✅; rate-limit ✅; `rihal-template/no-rate-limit-inside-auth` keeps `withRateLimit` composed OUTSIDE the auth wrapper at `error`, so floods are throttled before auth work runs ✅; no MFA (T-02). |
| A05 Security Misconfiguration | Security headers + CSP ✅; standalone build ✅. |
| A06 Vulnerable Components | `npm audit --audit-level=high --omit=dev` runs locally via `/ship` ✅ (and in `verify.yml` once CI is active). |
| A07 ID & Auth Failures | Auth.js v5 + bcryptjs ✅; rate limit ✅; no MFA ⚠️ (T-02); no account lockout ⚠️. |
| A08 Software & Data Integrity | gitleaks (full-history secret scan) ✅; Semgrep ✅ — both run locally via `/ship` and `/audit`. |
| A09 Logging & Monitoring | Auto-audit ✅; Sentry SaaS (opt-in per project, ADR-002) ✅; **audit-log retention is unscheduled** ⚠️ (T-06, IT to wire post-handoff); no Prometheus / metrics yet ⚠️. |
| A10 SSRF | No outbound HTTP from the app by default. |

ASVS Level 2 is a reasonable target once T-02 (MFA) is closed.

---

## 11. Findings register

(The severity→SLA table was removed in ADR-007: there is no team to make response-time promises to on a solo, free-plan rail. Severities below still indicate priority.)

| ID | Severity | Status | Title | Notes |
|---|---|---|---|---|
| T-01 | High | ✅ Closed (`e16a8c6`) | No rate limit on `/api/auth/*` | In-memory bucket, 10/min/IP. IP source hardened (2026-06-05): prefers `x-real-ip` over the spoofable `x-forwarded-for[0]`, and honors an optional `RATE_LIMIT_TRUSTED_IP_HEADER` (e.g. `cf-connecting-ip`) so a fork can trust only its proxy's real-client-IP header. Per-instance/in-memory remains best-effort — horizontally-scaled forks swap to `@upstash/ratelimit`. Contract suite asserts. |
| T-02 | High | Mitigation available (closed when SSO enforced) | No MFA | SSO via Microsoft Entra ID wired into `lib/auth.ts` (ADR-024). MFA is delegated to the IdP. A deployment that sets the Entra env vars **and** `AUTH_ENFORCE_SSO=true` removes password login (SSO-only) → T-02 **closed** for that deployment. Without enforcement, password login remains and the finding stays open for that fork (risk-accept in writing if shipping with both). |
| T-03 | High | ✅ Closed (`bb4918a`) | `passwordHash` snapshotted into `audit_logs` on user update | `SCRUB_FIELDS` redacts. Contract suite asserts. |
| T-04 | Medium | ✅ Closed (`104bc45`) | Container image tag pinned to `:latest` | The original GHCR/Portainer pipeline was removed in ADR-006; Vercel builds and serves directly from git (rollback is "promote a prior deployment"). The opt-in Docker self-host rail reintroduced in ADR-023 does **not** reopen this: base images are pinned by major (`node:22-alpine`, `postgres:17-alpine`) and the dormant `docker-build.yml` tags by commit SHA — never `:latest`. |
| T-05 | Medium | ✅ Closed (`de555fb`); hardened (nonce on script-src) | No CSP header | Conservative policy shipped first; now tightened to a **nonce-based** CSP built per-request in `middleware.ts` — `'unsafe-inline'` removed from script-src (recipe `shared-security/3`). `style-src` `'unsafe-inline'` remains for AntD 6 emotion inline-style attributes (AntD 7 revisit). Caveats in §4. |
| T-06 | Medium | ✅ Closed (2026-06-12, ADR-018) | No audit-log retention policy | Daily Vercel Cron in `vercel.json` GETs `/api/internal/audit-purge` (batched deletes, `maxDuration` capped, rate-limited). Dormant as a silent 200 no-op until `CRON_SECRET` is set; `/deploy` provisions the secret automatically. See §5. |
| T-07 | Medium | N/A — removed in ADR-006 | No encrypted backup pipeline | The age/rclone backup sidecar was deleted. Backups are now Neon's responsibility (PITR on the Launch tier). |
| T-08 | Low | ✅ Closed (`bf5b542`) | `session.user.role` typed as `any` | `next-auth` `User` augmented in `types/index.ts`; `lib/auth.ts` cast-free. Guarded by the `no-any-cast-on-session` ESLint rule. |
| T-09 | Low | N/A — removed in ADR-006 | MinIO uses root credentials in the app | MinIO was deleted. The template ships no object storage; `/scale-up` adds Vercel Blob if needed. |
| T-10 | Medium | ✅ Closed (2026-06-12) | Staging secrets in `deployment-state` branch history | Full-history gitleaks (2026-06-12, unshallowed clone) found 7 hits in `.deploy-state.staging.json` on the obsolete `deployment-state` branch (provision runs #41–#50, May 2026): `AUTH_SECRET`, `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `SEED_ADMIN_PASSWORD` for the **destroyed** droplet staging stack (ADR-006). Branch tip (run #55, "after destroy") is already scrubbed (`env: null`); `main` and all other branches are clean; the values never reached the `vibe-inspector` repo. Repo is private. Remediated: operator approved deleting the obsolete branch (2026-06-12); `deployment-state` removed from origin via the GitHub API; full-history gitleaks now clean. Residual operator action (2026-06-12, operator chose rotate-to-be-safe — reuse could not be ruled out): **rotate `AUTH_SECRET` and `SEED_ADMIN_PASSWORD` in every live Vercel project derived from this repo** (Vercel UI → Settings → Environment Variables → regenerate `AUTH_SECRET`, then redeploy — users re-login once; change the seeded admin's password in-app). Applies to the `vibe-inspector` deployment when it's stood up. |

**No-High gate before sharing externally.** An open High finding should block an external share unless a time-bound risk acceptance is documented here by the project owner.

---

## 12. Suppression log

Every SAST / SCA / secret-scan suppression appears here with rule ID, location, justification, reviewer, and date. **Never** bare `// nosem` or path-based gitleaks allowlists.

| Date | Tool | Rule | Location | Justification | Reviewer |
|---|---|---|---|---|---|
| 2026-06-04 | gitleaks | curl-auth-header | `docs/recipes/saas/2-api-keys-openapi.md` | Illustrative placeholder token `rk_live_xxx` in a `curl` example (not a real secret). Allowlisted by tight regex in `.gitleaks.toml`; the live example was also changed to `Bearer $API_KEY`. | Tariq Al-Naaimi |
| 2026-06-19 | npm audit | GHSA-p6gq-j5cr-w38f (nodemailer, High) | `audit-allowlist.json` | No fixed nodemailer version is published; the advisory is reachable only via the `raw`/attacker-controlled address path, which `lib/email.ts` never exercises. It cascades into the Auth.js chain (`@auth/core`, `next-auth`, `@auth/prisma-adapter`); downgrading `next-auth` would break the ADR-001 locked stack. Scoped allow in `audit-allowlist.json` (single advisory id, not a path/level relaxation); `/ship` still fails any other High+ advisory. Re-audit on every bump; remove the moment a fix ships. See §13. **WITHDRAWN 2026-06-24** — nodemailer@9.0.1 published the fix; bumped, `audit-allowlist.json` entry removed (now empty), `npm audit` reports 0 vulns. See §13. | Tariq Al-Naaimi |
| — | — | — | — | — | — |

---

## 13. Tracked CVE remediations

| Date | Package | Bump | CVE | Outcome |
|---|---|---|---|---|
| 2026-05-29 | `tmp` (transitive via `exceljs@4.4.0`) | `0.2.5` → `^0.2.7` via `package.json` `overrides` | Path traversal via unsanitized prefix/postfix (High) | Pinned the patched `tmp` without changing `exceljs` (already latest). `/ship` npm-audit gate clean at the high level; export contract test green. |
| 2026-06-01 | 14 advisories (2 low, 12 moderate): `postcss`/`next` chain (`@ant-design/nextjs-registry`, `@sentry/nextjs`, `next-intl`), `nodemailer` (SMTP injection), `exceljs`→`uuid`, dev-only `@prisma/dev`→`@hono/node-server` | No bump | Various moderate/low | **Reviewed, deferred — now RESOLVED 2026-06-05 (see next row).** At the time all were below the gate (none High/critical) and lacked a non-breaking `npm audit fix`. Subsequently cleared with targeted `overrides` + a `nodemailer` major bump. |
| 2026-06-05 | `uuid` 8.3.2→`^11` (via `exceljs`); `postcss` 8.4.31→`^8.5.10` (via the `next` chain); `@hono/node-server`→`^1.19.13` (dev-only, via `@prisma/dev`); `nodemailer` 7.0.13→`^8.0.5` (direct dep + override + `@types/nodemailer`→`^8`) | `overrides` pins + one direct-dep major bump | GHSA-w5hq-g745-h8pq (uuid buffer bounds); postcss `</style>` XSS; hono serveStatic middleware bypass; nodemailer SMTP injection (`envelope.size` / transport-name CRLF) | **Fixed — `npm audit` now reports 0 vulnerabilities (was 14).** `exceljs` uses only uuid's main-entry `{ v4 }` (compatible with v11); postcss 8.5 is a backward-compatible minor; hono override is dev-only tooling. `nodemailer` needed a direct-dep major (override alone hit `EOVERRIDE`); `lib/email.ts` uses only the stable `createTransport`/`sendMail` core. Verified: email contract test, production build, and full `/ship` gate all green. |
| 2026-06-19 | `nodemailer` (GHSA-p6gq-j5cr-w38f, High) | **No bump available** — triaged & scoped-allowed | nodemailer address-interpretation flaw reachable only via the `raw`/attacker-controlled address path | **Triaged NOT reachable; scoped allow recorded.** `lib/email.ts` never passes attacker-controlled `raw`/addresses through the affected path. No fixed nodemailer version is published, and the advisory cascades into the Auth.js chain (`@auth/core`, `next-auth`, `@auth/prisma-adapter`) — downgrading `next-auth` would break the ADR-001 locked stack. Scoped allow in `audit-allowlist.json` (single advisory id; `/ship` still gates every other High+ CVE). Re-audit on every bump; remove the entry the moment an upstream fix ships. See §12. **→ RESOLVED 2026-06-24, see next row.** |
| 2026-06-24 | `nodemailer` 8.0.11→`^9.0.1` (direct dep + `overrides`) | Major bump (8→9) | GHSA-p6gq-j5cr-w38f (raw-option file-read / SSRF in the delivered message, High) | **Fixed — `npm audit --omit=dev` now reports 0 vulnerabilities** (was 4 High, all this advisory cascading through `@auth/core`/`next-auth`/`@auth/prisma-adapter`). 9.0.1 is the first published fix, exactly the upstream resolution the 2026-06-19 scoped-allow anticipated; `audit-allowlist.json` advisories list emptied. `lib/email.ts` uses only the stable `createTransport`/`sendMail` core (never the `raw` option), so the major is API-compatible for this app. The Auth.js chain declares `nodemailer` peer `^7`; pinned to `^9.0.1` via `overrides` since v9 is back-compatible for the email-provider path. `@types/nodemailer` has no v9 yet (latest 8.0.1); kept at `^8`. Verify before merge: typecheck + production build. |
| — | — | — | — | — |

---

## 14. CI security gates

Workflows live in `.github/workflows/`:

| Workflow | Triggers | What it gates | Blocks on |
|---|---|---|---|
| `verify.yml` | PR + push (non-main) | `tsc --noEmit`, ESLint (incl. local plugin), `node:test` contract suite, component tests (`test:components`), `next build` (with `.next/cache`), `npm audit --audit-level=high --omit=dev`, scaffold smokes | High+ CVE in a production dep, typecheck error, lint error, test failure, build failure, scaffold breakage |
| `secrets-scan.yml` | PR + push (any) | gitleaks across full git history; uploads SARIF to the Security tab | Any detected secret pattern |
| `sast.yml` | PR + push (any) | Semgrep with `p/javascript`, `p/typescript`, `p/nextjs`, `p/react`, `p/owasp-top-ten`, `p/secrets`; uploads SARIF to the Security tab | Any finding at default severity |
| `codeql.yml` | Manual dispatch + weekly schedule | CodeQL `javascript-typescript` analysis; results in the Security tab | Any finding at the configured severity |
| `senior-review.yml` | PR + push (non-main) | Async post-push breadth review by the `senior-code-reviewer` (cross-cutting invariants, adversarial/output-side trust boundaries, operational drift) — layers on top of the pre-push `/code-review` diff gate (ADR-020). Non-blocking; dormant until `ANTHROPIC_API_KEY` + triggers are set. | — (advisory) |
| `uat.yml` | Manual dispatch | Playwright UAT against a deployed URL; uploads a screenshot report. Not a gate. | — |
| `new-project.yml` | Manual dispatch | One-shot provisioner (GitHub repo + Neon + Vercel + Cloudflare DNS). Not a gate. | — |

(All are **dormant** on the free plan — triggers are `workflow_dispatch` (and a dormant `schedule` for `codeql.yml`). The SARIF upload steps in `secrets-scan.yml` / `sast.yml` are guarded so they no-op when there is nothing to upload. The active gate is local `/ship`. See the paragraph below + ADR-007.)

**On the current plan (solo operator, free GitHub plan with Actions billing blocked) these workflows do not run.** Their security checks are mirrored locally by the `/ship` skill (typecheck → lint → tests → build → gitleaks → npm audit) plus the on-demand `/audit` skill (gitleaks + npm audit + Semgrep). **CI activates at `/handoff`**, when the IT team's paid plan can run Actions and enforce branch protection.

---

## 15. Test coverage gates

The contract suite (`tests/contracts/*.test.ts`, run via `node:test` + `tsx`) covers the highest-risk invariants. Failures block `/ship` locally (and `verify.yml` once CI is active).

| Module | Test file | Covers |
|---|---|---|
| `lib/rate-limit.ts` | `tests/contracts/rate-limit.test.ts` | Allow within window, block past limit, separate buckets per `id`, separate buckets per IP, `x-real-ip` fallback, window expiry resets bucket |
| `lib/prisma/audit-extension.ts` (the `scrub` + `computeChanges` + `SCRUB_FIELDS` exports) | `tests/contracts/audit-scrub.test.ts` | Per-field redaction, non-scrubbed pass-through, null/undefined edge cases, change detection, `updatedAt` skip, no-op detection, unscrubbed verbatim, `SCRUB_FIELDS` membership |
| `lib/email.ts` | `tests/contracts/email.test.ts` | `sendEmail` gated by `SMTP_HOST` (returns `{ sent: false }` when unset), metadata-only logging (never body), transport invocation shape |
| `lib/export.ts` | `tests/contracts/export.test.ts` | `toExcel` buffer generation, column mapping + `format` callbacks, `excelDownloadHeaders` content-type + filename |
| `lib/sentry.ts` | `tests/contracts/sentry-scrub.test.ts` | Context scrubbing shares `SCRUB_FIELDS`, `setUserContext` forwards only the id (no email / name / PII), `setUserContext(null)` clears, `captureError` with/without context |
| `lib/api-helpers.ts` (auth wrappers) | `tests/contracts/api-auth.test.ts` | `withInternalAuth`: 503 when the token env var is unset (200 `{skipped:true}` with `skipWhenUnconfigured`), 401 on missing / mismatched `x-internal-token`, pass-through on match; Bearer accepted only with `{ bearer: true }` (strict `Bearer ` prefix, rejected by default, never overrides a present `x-internal-token`). `withAuth` / `withAdminAuth`: 401 with no session, 403 for a non-admin, session pass-through to the handler, ADMIN pass-through |

**Note on the auth-wrapper tests.** The session-bearing cases stub `auth()` (and `lib/sentry`) via `node:test`'s `mock.module`, which needs `--experimental-test-module-mocks`. The plain `npm test` command does not pass that flag, so those cases **self-skip** there — but the `withInternalAuth` token-gate cases (the security-critical branch) run on every `npm test`. To exercise the full file:
```
node --experimental-test-module-mocks --import tsx --test tests/contracts/api-auth.test.ts
```

Still deliberately not covered (would need disproportionate Prisma mocking for the value): the soft-delete extension behavior and `middleware.ts` request routing. These are smoke-tested by every entity that uses them and by `/uat`; explicit unit tests are a future bucket.

**Adding a new Restricted field-name to `SCRUB_FIELDS`?** Add it to the membership assertion in `tests/contracts/audit-scrub.test.ts` in the same commit, or future contributors lose the assertion that the field is scrubbed.

---

## 16. Shared-tier security checklist (at `/handoff`)

The template's **security floor** (auth wrappers, no leaked secrets, zod at every
boundary, no raw SQL, the ten `rihal-template/*` ESLint rules, audit log ON, `/ship`
before every push) holds for **both** tiers from day zero — see `CLAUDE.md` → "Project
tiers". A prototype that has only been reviewed by stakeholders via a shared URL is **not
yet cleared to hold sensitive (Confidential / Restricted) production data.**

A `shared`-tier fork must complete the following **post-UAT, before-handoff** layers before
it handles sensitive data. `/handoff` surfaces this list; each item is "done or risk-accepted
in writing by the project owner" (record acceptances in §11).

| # | Layer | Why / finding | Where |
|---|---|---|---|
| 1 | **MFA** (WebAuthn / TOTP, or front the app with an SSO provider) | Closes **T-02** (open High). A single stolen credential is full account takeover without it. | **Microsoft Entra ID SSO is wired in** (`lib/auth.ts`, ADR-024): set the Entra env vars + `AUTH_ENFORCE_SSO=true` to make IdP MFA mandatory. (TOTP recipe `2-mfa-totp` remains for forks wanting an in-app factor.) |
| 2 | **Atomic audit** (Postgres-trigger-based audit writing `audit_logs` in the same transaction as the DML) | **ADR-010** accepted the non-atomic gap for the prototype rail; a shared fork carrying records that must be tamper-evident closes it. Recipe: `docs/recipes/shared-security/4-atomic-audit-triggers.md` — `/handoff` offers to apply it before regulated data is handed over. | DB triggers + its own ADR |
| 3 | **Nonce-based CSP** (drop `'unsafe-inline'` on `script-src` / `style-src`) | **T-05** shipped a conservative CSP that allowed inline for Ant Design SSR + Next bootstrap. Nonce-CSP removes the XSS-amplification surface. | ✅ **Done for script-src** — per-request nonce built in `middleware.ts` (Next auto-nonces its scripts via the request CSP header). `style-src` `'unsafe-inline'` remains for AntD 6 emotion inline-style attributes; revisit at Ant Design 7 (ADR-001 trigger). |
| 4 | **Account lockout / brute-force throttle** across instances | A07 gap (no lockout); the in-memory rate limiter is per-instance and reset on cold start. | Upstash Redis + `@upstash/ratelimit` (`/scale-up` → "Rate limiter across instances") |
| 5 | **Column-level encryption** for any Restricted field beyond what `SCRUB_FIELDS` covers | `SCRUB_FIELDS` only protects audit/Sentry payloads, not the row at rest. Restricted columns (salary, health, national ID, etc.) need encryption + its own ADR (ADR-001 migration trigger). | Prisma field encryption + ADR |
| 6 | **SARIF / CodeQL active** in the Security tab | `codeql.yml` + the SARIF uploads in `secrets-scan.yml` / `sast.yml` are dormant on the free plan; activate them with branch protection at handoff so findings are visible and gating. | §14 + `.github/workflows/` |

**Ready-to-apply recipes** (full template-specific code — open, apply, `/code-review`, `/ship`):
items 1–5 map directly to `docs/recipes/shared-security/` (`2-mfa-totp`, `4-atomic-audit-triggers`,
`3-nonce-csp`, `1-account-lockout`, `5-column-encryption`); item 6 is `.github/workflows/`
(activate at handoff). SSO / API-keys / webhooks / SCIM recipes are in `docs/recipes/saas/`.
The recipes are kept out of the lean base by design — see **ADR-014**.

`personal`-tier forks skip this checklist (there is no handoff and no sensitive-data
mandate); the security floor still applies.
