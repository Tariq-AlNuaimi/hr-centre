# SECURITY — Fullstack Next.js Template

Template-level security baseline. **When you fork this into a project, this file is load-bearing:** every change that touches auth, roles, data classification, encryption, audit, secrets, retention, or external network calls updates this file in the same commit. The sections below describe what the template ships out of the box; downstream projects must replace placeholders, fill in data classes for the actual entities they store, and re-run the threat model on first commit.

**This template is unclassified.** It contains no real data and is not a deployment. Tier and PDPL posture are set per project — see §9.

---

## 1. Data classification

Every field carries one of four labels. Drives encryption, access, logging, retention. The template only ships the auth-and-audit surface; project-owned models inherit this framework.

| Class | Definition | Examples in the template |
|---|---|---|
| **Public** | No harm if disclosed | Static assets in `public/`, i18n message files in `messages/` |
| **Internal** | No individual harm if leaked | `audit_logs.action`, `audit_logs.entityType`, role definitions (`Role` enum), seed fixtures |
| **Confidential** | Disclosure harms individuals / contracts / competitive position | `users.email`, `users.name`, `users.image`, `users.lastLoginAt`, `audit_logs.before` / `after` / `changes` JSON blobs (they snapshot whatever entity you write — if the entity holds Confidential fields, the audit row inherits the label), `audit_logs.ipAddress`, `audit_logs.userAgent`, any file uploaded to MinIO |
| **Restricted** | Significant harm or legal liability | `AUTH_SECRET`, `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY` / `MINIO_ROOT_PASSWORD`, `SEED_ADMIN_PASSWORD`, `users.passwordHash` (bcryptjs — irreversible but still secret-equivalent if exfiltrated), Auth.js JWT cookies in transit, `accounts.refresh_token` / `access_token` / `id_token`, MinIO presigned URLs (time-limited but exploitable in the window), `AUTH_GOOGLE_SECRET` if OAuth is enabled |

**Operational rules per class:**

- **Restricted:** never logged, never returned by an API outside the owning user's own session, never in default exports, never in `audit_logs.before` / `after` (the audit extension snapshots full rows — if you add a Restricted column to a model, scrub it in the extension or move it to a side table). MinIO presigned URLs are short-lived (1h default) and must never appear in audit metadata or server logs.
- **Confidential:** auth + role gate at the API boundary. Logged on sensitive read where the project defines one (the template doesn't ship read-side audit — write-side only).
- **Internal:** auth + role gate.
- **Public:** can appear unauthenticated.

**Downstream projects:** add a row per Restricted field you introduce and reconcile the audit-extension snapshot behavior on the same commit.

---

## 2. Authentication — current

🟢 **Auth.js v5 (next-auth beta) with Credentials provider, JWT session strategy.** Configuration lives in `lib/auth.ts`. Sign-in page: `/login` (per-locale). Middleware (`middleware.ts`) gates every non-public path and returns `401` on unauthenticated API calls.

- **Password hashing:** `bcryptjs.compare` against `users.passwordHash`. Seed hashes use the bcryptjs default cost factor; any project-introduced reset endpoint must use the same library. **Never** MD5 / SHA1 / raw SHA256 / plain PBKDF2.
- **Session payload:** JWT only. Carries `{id, role}` on the `token` and exposes them on `session.user`. The `sessions` table exists because the Prisma adapter is wired (needed for OAuth account linking), but JWT sessions are not written there — don't query `sessions` to enumerate active users.
- **OAuth:** Google provider is wired but commented out in `lib/auth.ts`. Uncomment + set `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` to enable. Any provider added must be reflected here.
- **Public paths** (no auth required) are listed in `middleware.ts`: `/login`, `/api/auth/*`, `/api/health`. Adding a public path requires a SECURITY.md entry and an ADR.
- **`prismaUnfiltered` in the authorize callback** is intentional — it sees soft-deleted users so the callback can distinguish "no such email" from "deactivated user" without leaking which. The `where` clause still filters `deletedAt: null` so deleted users cannot log in.

**Brute-force defense:** ⚠️ **Not shipped in the template.** Credentials login has no rate limiter. Downstream projects MUST add one (e.g. `@upstash/ratelimit` or middleware in front) before any production deploy. Tracked as **T-01** in §11.

**Account lifecycle:** seeding creates one admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Downstream projects MUST rotate `SEED_ADMIN_PASSWORD` on first login or remove the seed call from the entrypoint after initial deploy.

---

## 3. Authorization — current

🟢 Three-role enum: `ADMIN` / `EDITOR` / `VIEWER` (`prisma/schema.prisma` `Role`). Bound to `users.role`; the JWT carries it.

- **Boundary checks:** every API route handler wraps with `withAuth` (any authenticated user) or `withAdminAuth` (ADMIN only) from `lib/api-helpers.ts`. UI gating is defense-in-depth, **not** the boundary.
- **EDITOR vs VIEWER split is not enforced by the template** — only Admin-vs-not. Downstream projects that need EDITOR > VIEWER must add a `withEditorAuth` (or a permission-string `can()` helper) and document it here.
- **Row-level scoping** (e.g. "users only see their own records") is project-specific. Add an explicit `WHERE` clause in every list / get query. Don't rely on UI filtering. Postgres RLS is not enabled by default.
- **`session.user.role` is typed as `any`** today (no Auth.js module augmentation). Treat it as a string; guard before use. Tracked as **T-08** in §11.

---

## 4. Encryption — current

| Layer | State |
|---|---|
| TLS in transit | ⚠️ **Not in the template.** The Next.js container speaks HTTP on `:3000`. Put a TLS-terminating reverse proxy (Caddy / nginx / Cloudflare) in front in any environment past local dev. HSTS header is emitted by `next.config.ts` regardless. |
| Disk encryption | Inherits from host. Document per project. |
| Column encryption of Restricted fields | ⚠️ **None.** `passwordHash` is bcrypt-hashed (not encrypted — irreversible by design). If a downstream project introduces Restricted columns (e.g. salary, API tokens), add pgcrypto or app-layer AES-256-GCM and a row here. |
| Backup encryption | ⚠️ **Not in the template.** Postgres data lives in the `pgdata` Docker volume; MinIO objects in `miniodata`. No backup pipeline ships. Downstream projects MUST add encrypted backups + a tested restore drill before storing real Confidential data. Tracked as **T-07** in §11. |
| Secrets in code | ✅ None. All in `.env` (mode 600 on the host) or repo secrets. `.env.example` is in git; `.env` is in `.gitignore`. |
| Password hashing | ✅ bcryptjs only (`lib/auth.ts`). Default cost factor. **Never** MD5 / SHA1 / raw SHA256 / plain PBKDF2. |
| Auth.js JWT signing | ✅ `AUTH_SECRET` (Restricted). Rotation invalidates every session. |
| MinIO at rest | Inherits from MinIO config + disk encryption. Default install is unencrypted at rest. Document per project. |

**Default security headers** (emitted by `next.config.ts` on every response): `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. **CSP is not set** — tracked as **T-05** in §11.

---

## 5. Audit logging — current

🟢 **Schema + writer ship with the template** (`prisma/schema.prisma` `AuditLog` + `lib/prisma/audit-extension.ts`). The Prisma extension auto-records every `create` / `update` / `delete` on every model **outside the EXCLUDE set** (`AuditLog`, `Account`, `Session`, `VerificationToken`).

- **Captured per row:** `timestamp`, `entityType`, `entityId`, `action` (`CREATE` / `UPDATE` / `DELETE` / `RESTORE`), `before` (JSON snapshot pre-write), `after` (JSON snapshot post-write), `changes` (diff with `updatedAt` excluded), `userId` (from `AuditContext`), `ipAddress`, `userAgent`.
- **Soft-delete detection:** an `update` that sets `deletedAt` from null is rewritten as `action: "DELETE"`; an update that clears `deletedAt` is `action: "RESTORE"`.
- **Attribution comes from `AuditContext`** seeded by `withAuth` / `withAdminAuth`. **Calls outside the wrappers (cron jobs, seed scripts, repair scripts) attribute to `null` user.** Document any such caller per project.
- **`before` / `after` are full row snapshots.** If you add a Restricted column to a model, you MUST either scrub it from the snapshot inside the extension or move it to a side table that lives in the EXCLUDE set — otherwise the secret leaks into `audit_logs`. The template ships `users.passwordHash`, which gets snapshotted on user updates today; downstream projects with credential-rotation flows must scrub it. Tracked as **T-03** in §11.
- **Retention:** undefined in the template. Audit rows accumulate forever. Add a retention policy + cron job per project. Tracked as **T-06** in §11.
- **Append-only:** enforced at the application layer (the extension never issues UPDATE / DELETE on `AuditLog`). No DB-level `REVOKE` is set.

---

## 6. Secrets

| Secret | Today | Notes |
|---|---|---|
| `AUTH_SECRET` | `.env` (Restricted) | JWT signing key. Rotation invalidates every session. Generate with `openssl rand -base64 32`. |
| `POSTGRES_PASSWORD` | `.env` / repo secret (Restricted) | DB superuser-equivalent for the app role. Rotation requires DB lockout coordination. |
| `MINIO_ROOT_PASSWORD` / `MINIO_SECRET_KEY` | `.env` (Restricted) | MinIO root creds. Rotation invalidates every presigned URL in flight. |
| `MINIO_ROOT_USER` / `MINIO_ACCESS_KEY` | `.env` (Confidential) | Rotate as a unit with the secret half. |
| `SEED_ADMIN_PASSWORD` | `.env` (Restricted) | One-shot bootstrap. Rotate on first login or remove the seed call from the entrypoint after initial deploy. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | `.env` (Restricted — only if OAuth enabled) | Provider creds. Rotate from Google Cloud Console. |
| `DATABASE_URL` | `.env` (Confidential — embeds the password) | Reconstruct from `POSTGRES_*` rather than logging the URL. |
| `PORTAINER_WEBHOOK_URL` | GitHub repo secret (Restricted) | Anyone with this URL can trigger a redeploy of the current `:latest` image tag. Rotate via Portainer if leaked. |
| GHCR push token | `GITHUB_TOKEN` (Restricted — managed by Actions) | Inherits the workflow token; no manual rotation needed. |

**Rotation log:** (downstream projects record every rotation event here)

| Date | Secret | Reason | Operator |
|---|---|---|---|
| — | — | — | — |

Rotate any secret after any chat-history-with-secret event. Rotating must never require a code change. ✅

`.env.example` lives in git. `.env` never does. ✅

---

## 7. Threat model — top 5

Template-level baseline. Re-run per project on: scope expansion, new external integration, new dependency > 50 KB, host provider change, role enum change.

### T1 — Stolen credential
- **Who:** anyone with access to a user's mailbox or password manager
- **Vector:** phishing; password reuse from another breach; insider sharing
- **Blast:** full session at the user's role. ADMIN can mint users + change roles.
- **Control:** bcryptjs hashes ✅; JWT signed with `AUTH_SECRET` ✅; audit log of every write ✅; soft-delete-aware login (deleted user cannot log in) ✅. ⚠️ **No rate limit** on `/api/auth/*` in the template — see **T-01**. **No MFA** — see **T-02**. Mitigation cap: rotate the user's password + force re-login by rotating `AUTH_SECRET`.

### T2 — Audit-log snapshot leak
- **Who:** anyone with read access to `audit_logs`
- **Vector:** the audit extension snapshots full row state into `before` / `after`. If a model holds a Restricted field, that field is now duplicated into the audit table.
- **Blast:** Restricted fields exfiltrate at audit-table granularity. The template ships `users.passwordHash` getting snapshotted on user updates today.
- **Control:** scrub Restricted fields in the audit extension before writing the snapshot, or move them to a side table in the EXCLUDE set. Tracked as **T-03** in §11.

### T3 — MinIO presigned URL leak
- **Who:** anyone the URL is shared with within the expiry window
- **Vector:** URL logged accidentally, leaked via referer header, forwarded in chat
- **Blast:** read or write to the specific object until the URL expires.
- **Control:** short expiry (default 1h) ✅; never log presigned URLs ✅ (project-enforced); restrict bucket policy so the access key cannot list / escalate ⚠️ — template uses the root key (tracked as **T-09**).

### T4 — Compromised Portainer webhook
- **Who:** attacker who obtains `PORTAINER_WEBHOOK_URL`
- **Vector:** webhook URL in chat history; CI log leak; compromised maintainer machine
- **Blast:** can force a redeploy of the current GHCR image tag — does NOT let them push code, but can replay an old `:latest` snapshot to roll back security fixes.
- **Control:** stored as a GitHub repo secret ✅; rotate in Portainer if leaked; pin image to git SHA (not `latest`) in `docker-compose.prod.yml` for stronger guarantees ⚠️ — tracked as **T-04**.

### T5 — Host compromise
- **Who:** opportunistic attacker / botnet
- **Vector:** unpatched host OS; weak SSH; exposed Portainer admin
- **Blast:** full exfil — `AUTH_SECRET`, `POSTGRES_PASSWORD`, `MINIO_*`, every `passwordHash`, every uploaded file, every audit row.
- **Control:** project-specific. Document host hardening + key-only SSH + firewall posture per project.

---

## 8. Incident response

Project-specific. Template stub:

If a leak is suspected, credentials posted publicly, traffic looks abnormal, or audit-log writes fail:

1. **On-call is paged** (project to name primary + secondary).
2. **Immediate actions:** rotate the suspected secret (`AUTH_SECRET` → forces re-login of all users; `POSTGRES_PASSWORD` → DB lockout window; `MINIO_*` → invalidates presigned URLs); take the public hostname offline at the reverse proxy or DNS (fastest shutdown); snapshot the host volumes for forensics.
3. **Decision authority:** project to name (technical shutdown vs. external comms).
4. **External comms:** never without sign-off from leadership + legal.

---

## 9. Compliance baseline

Project-specific. The template is unclassified. When the fork stores data covered by Omani PDPL (Royal Decree 6/2022) or another regime, document basis (legitimate interest / consent), data minimization, retention defaults, cross-border transfer posture, and breach-response flow here.

---

## 10. OWASP Top 10 — template coverage

| Risk | Coverage in the template |
|---|---|
| A01 Broken Access Control | `withAuth` / `withAdminAuth` boundary wrappers ✅; UI gating is defense-in-depth, not the boundary; middleware enforces auth on every non-public path ✅; row-level scoping is project-specific. |
| A02 Cryptographic Failures | TLS terminated by a reverse proxy in front (out of template scope) ⚠️; HSTS header emitted ✅; bcryptjs for passwords ✅; no column encryption shipped ⚠️. |
| A03 Injection | Prisma parameterizes everything ✅; zod validates inputs at the API boundary ✅; no `$executeRawUnsafe` in the template ✅. |
| A04 Insecure Design | Audit + soft-delete are framework-enforced ✅; no rate limiting ⚠️ (T-01); no MFA ⚠️ (T-02). |
| A05 Security Misconfiguration | Security headers in `next.config.ts` ✅; CSP not set ⚠️ (T-05); Dockerfile runs as non-root `nextjs` user ✅; image is multi-stage standalone ✅. |
| A06 Vulnerable Components | `npm audit` + Dependabot are project-level concerns; not wired in the template ⚠️. |
| A07 ID & Auth Failures | Auth.js v5 + bcryptjs ✅; no rate limit ⚠️ (T-01); no MFA ⚠️ (T-02); no account lockout ⚠️. |
| A08 Software & Data Integrity | GHCR image tagged `:latest` in `docker-compose.prod.yml` ⚠️ (T-04 — pin to SHA); webhook redeploys are project-trust-only; gitleaks / SAST not wired in the template ⚠️. |
| A09 Logging & Monitoring | Auto-audit on Prisma writes ✅; no Sentry / Prometheus wired ⚠️; no retention policy ⚠️ (T-06). |
| A10 SSRF | No outbound HTTP from the app by default. If OAuth or external API calls are added, document here. |

ASVS Level 2 is a reasonable target once the open findings below are closed.

---

## 11. Findings SLAs

| Severity | SLA |
|---|---|
| Critical | 7d (feature-flag off if not patched) |
| High | 30d |
| Medium | 90d |
| Low | best-effort |

**Open findings shipped with the template** (downstream projects MUST triage before production):

| ID | Severity | Title | Notes |
|---|---|---|---|
| T-01 | High | No rate limit on `/api/auth/*` | Credentials login is unprotected against brute force. Add `@upstash/ratelimit` or equivalent. |
| T-02 | High | No MFA | Credentials provider is single-factor. Wire WebAuthn or TOTP, or front with an SSO provider. |
| T-03 | High | `passwordHash` snapshotted into `audit_logs` on user update | Scrub the field in `lib/prisma/audit-extension.ts` before writing `before` / `after`. |
| T-04 | Medium | GHCR image tag pinned to `:latest` in `docker-compose.prod.yml` | Switch to git-SHA tags so a rollback / replay attack can't silently revert security fixes. |
| T-05 | Medium | No CSP header | Add a CSP in `next.config.ts` once the project's asset hosts are known. |
| T-06 | Medium | No audit-log retention policy | Rows accumulate forever. Define retention + a cron job per project. |
| T-07 | Medium | No encrypted backup pipeline | Postgres + MinIO volumes are unprotected. Add encrypted backup + tested restore before storing real Confidential data. |
| T-08 | Low | `session.user.role` typed as `any` | Set up Auth.js v5 module augmentation. |
| T-09 | Low | MinIO uses root credentials in the app | Mint a scoped access key with bucket-only permissions; rotate the root key out of `.env`. |

**No-Critical/High gate before production.** An open finding blocks release unless a time-bound risk acceptance is documented here by the project owner.

---

## 12. Suppression log

Every SAST / SCA / secret-scan suppression appears here with rule ID, location, justification, reviewer, and date. **Never** bare `// nosem` or path-based gitleaks allowlists. The template ships no scanners — populate when you wire them.

| Date | Tool | Rule | Location | Justification | Reviewer |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

---

## 13. Tracked CVE remediations

| Date | Package | Bump | CVE | Outcome |
|---|---|---|---|---|
| — | — | — | — | — |
