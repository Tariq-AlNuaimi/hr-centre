# SECURITY — Fullstack Next.js Template

Template-level security baseline. **When you fork this into a project, this file is load-bearing:** every change that touches auth, roles, data classification, encryption, audit, secrets, retention, or external network calls updates this file in the same commit. The sections below describe what the template ships out of the box; downstream projects must replace placeholders, fill in data classes for the actual entities they store, and re-run the threat model on first commit.

**This template is unclassified.** It contains no real data and is not a deployment. Tier and PDPL posture are set per project — see §9.

---

## 1. Data classification

Every field carries one of four labels. Drives encryption, access, logging, retention. The template only ships the auth-and-audit surface; project-owned models inherit this framework.

| Class | Definition | Examples in the template |
|---|---|---|
| **Public** | No harm if disclosed | Static assets in `public/`, i18n message files in `messages/` |
| **Internal** | No individual harm if leaked | `audit_logs.action`, `audit_logs.entityType`, role definitions (`Role` enum), seed fixtures, `AUDIT_RETENTION_DAYS`, `BACKUP_ENABLED`, `RCLONE_REMOTE` / `BACKUP_BUCKET` names |
| **Confidential** | Disclosure harms individuals / contracts / competitive position | `users.email`, `users.name`, `users.image`, `users.lastLoginAt`, `audit_logs.before` / `after` / `changes` JSON blobs (they snapshot whatever entity you write — if the entity holds Confidential fields, the audit row inherits the label), `audit_logs.ipAddress`, `audit_logs.userAgent`, any file uploaded to MinIO |
| **Restricted** | Significant harm or legal liability | `AUTH_SECRET`, `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY` / `MINIO_ROOT_PASSWORD`, `SEED_ADMIN_PASSWORD`, `AUDIT_PURGE_TOKEN`, `BACKUP_AGE_IDENTITY`, `RCLONE_CONFIG` (contains remote credentials), `users.passwordHash` (bcryptjs — irreversible but still secret-equivalent if exfiltrated), Auth.js JWT cookies in transit, `accounts.refresh_token` / `access_token` / `id_token`, MinIO presigned URLs (time-limited but exploitable in the window), `AUTH_GOOGLE_SECRET` if OAuth is enabled |

**Operational rules per class:**

- **Restricted:** never logged, never returned by an API outside the owning user's own session, never in default exports. `audit_logs.before` / `after` automatically scrub Restricted field values via `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` (see §5). MinIO presigned URLs are short-lived (1h default) and must never appear in audit metadata or server logs.
- **Confidential:** auth + role gate at the API boundary. Logged on sensitive read where the project defines one (the template doesn't ship read-side audit — write-side only).
- **Internal:** auth + role gate.
- **Public:** can appear unauthenticated.

**Downstream projects:** when introducing a new Restricted field, (1) add a row above and (2) extend `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` and `tests/contracts/audit-scrub.test.ts` in the same commit.

---

## 2. Authentication — current

🟢 **Auth.js v5 (next-auth beta) with Credentials provider, JWT session strategy.** Configuration lives in `lib/auth.ts`. Sign-in page: `/login` (per-locale). Middleware (`middleware.ts`) gates every non-public path and returns `401` on unauthenticated API calls.

- **Password hashing:** `bcryptjs.compare` against `users.passwordHash`. Seed hashes use the bcryptjs default cost factor; any project-introduced reset endpoint must use the same library. **Never** MD5 / SHA1 / raw SHA256 / plain PBKDF2.
- **Session payload:** JWT only. Carries `{id, role}` on the `token` and exposes them on `session.user` (typed via `types/index.ts`). The `sessions` table exists because the Prisma adapter is wired (needed for OAuth account linking), but JWT sessions are not written there.
- **OAuth:** Google provider is wired but commented out in `lib/auth.ts`. Uncomment + set `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` to enable.
- **Public paths** (no session auth required) are listed in `middleware.ts`: `/login`, `/api/auth/*`, `/api/health`, `/api/internal/*`. Internal routes are gated by a shared-secret `x-internal-token` header via `withInternalAuth(tokenEnv, ...)` instead.
- **`prismaUnfiltered` in the authorize callback** is intentional — it sees soft-deleted users so the callback can distinguish "no such email" from "deactivated user" without leaking which. The `where` clause still filters `deletedAt: null` so deleted users cannot log in.

**Brute-force defense:** 🟢 **In-memory token bucket in `lib/rate-limit.ts`, applied to POST on `/api/auth/*` at 10/min/IP.** Returns 429 with `Retry-After` when exceeded. Horizontally-scaled forks MUST swap to a shared-state limiter (e.g. `@upstash/ratelimit` backed by Redis or Upstash). The contract suite (`tests/contracts/rate-limit.test.ts`) asserts the bucket semantics on every push.

**Account lifecycle:** seeding creates one admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Downstream projects MUST rotate `SEED_ADMIN_PASSWORD` on first login or remove the seed call from the entrypoint after initial deploy.

---

## 3. Authorization — current

🟢 Three-role enum: `ADMIN` / `EDITOR` / `VIEWER` (`prisma/schema.prisma` `Role`). Bound to `users.role`; the JWT carries it.

- **Boundary checks:** every API route handler wraps with `withAuth` (any authenticated user) or `withAdminAuth` (ADMIN only) or `withInternalAuth` (shared-secret) from `lib/api-helpers.ts`. UI gating is defense-in-depth, **not** the boundary.
- **EDITOR vs VIEWER split is not enforced by the template** — only Admin-vs-not. Downstream projects that need EDITOR > VIEWER must add a `withEditorAuth` (or a permission-string `can()` helper) and document it here.
- **Row-level scoping** (e.g. "users only see their own records") is project-specific. Add an explicit `WHERE` clause in every list / get query. Postgres RLS is not enabled by default.
- **`session.user.role`** is typed as `Role` via the augmentation in `types/index.ts`; callbacks in `lib/auth.ts` are cast-free.

---

## 4. Encryption — current

| Layer | State |
|---|---|
| TLS in transit | ⚠️ **Not in the template.** The Next.js container speaks HTTP on `:3000`. Put a TLS-terminating reverse proxy (Caddy / nginx / Cloudflare) in front. HSTS header is emitted by `next.config.ts` regardless. |
| Disk encryption | Inherits from host. Document per project. |
| Column encryption of Restricted fields | ⚠️ **None.** `passwordHash` is bcrypt-hashed (irreversible by design). If a downstream project introduces Restricted columns (salaries, API tokens), add pgcrypto or app-layer AES-256-GCM and a row here. |
| Backup encryption | 🟢 Postgres dump + MinIO tar encrypted via `age` to a recipient public key at `/opt/backup/recipient` (host bind, mode 644). Identity (private key) lives **only** in `BACKUP_AGE_IDENTITY` repo secret — not on the host that performs encryption. Off-host copy via `rclone` to a vendor-agnostic S3-compatible target. On-host retention 30d, off-host 90d. See `deploy/backup.sh` + `docker-compose.prod.yml` `backup` service. Gated by `BACKUP_ENABLED=true` (defaults off until `/first-fork` step 6 flips it on). |
| Tested restore | 🟢 Quarterly via `.github/workflows/restore-test.yml` — cron `0 3 1 1,4,7,10 *`. Decrypts the newest backup with `BACKUP_AGE_IDENTITY`, restores into an ephemeral Postgres service, asserts `SELECT count(*) > 0 FROM users`. Skips with a warning if backup secrets are not yet configured. |
| Secrets in code | ✅ None. All in `.env` (mode 600 on the host) or repo secrets. `.env.example` is in git; `.env` is in `.gitignore`. Enforced by `secrets-scan.yml` (gitleaks) on every push. |
| Password hashing | ✅ bcryptjs only (`lib/auth.ts`). Default cost factor. **Never** MD5 / SHA1 / raw SHA256 / plain PBKDF2. |
| Auth.js JWT signing | ✅ `AUTH_SECRET` (Restricted). Rotation invalidates every session. |
| MinIO at rest | Inherits from MinIO config + disk encryption. Default install is unencrypted at rest. Document per project. |

**Default security headers** (emitted by `next.config.ts`): Content-Security-Policy, X-Frame-Options: SAMEORIGIN, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy, Strict-Transport-Security. CSP allows `'unsafe-inline'` for script/style (Ant Design SSR + Next bootstrap); `'unsafe-eval'` added only in dev for HMR.

**Restore-drill cadence + reviewer roster** (project-specific; default template values):

- Cron: 03:00 UTC on the 1st of Jan / Apr / Jul / Oct.
- On-demand: any change to `deploy/backup.sh`, `restore-test.yml`, or `BACKUP_AGE_IDENTITY` / `RCLONE_CONFIG` repo secrets MUST be followed by a manual `workflow_dispatch` of `restore-test.yml`.
- Reviewer-of-record: project owner.
- **Where the identity lives:** GitHub repo secret only — never on the host that runs encryption. A host compromise cannot decrypt prior backups.
- **Rotation:** annually + on personnel changes. Procedure mirrors `rihal-ops-portal` §4 — generate new keypair on host, copy the recipient public key to `/opt/backup/recipient`, paste the secret line into the `BACKUP_AGE_IDENTITY` repo secret, shred the temp file, trigger a `workflow_dispatch` of the next nightly backup, trigger `restore-test.yml` to verify the new identity decrypts the new ciphertext. Old ciphertext stays decryptable with the prior identity until the 90-day off-host window expires — keep the prior identity in escrow (1Password / Vault) labelled with that expiry date, then destroy.

---

## 5. Audit logging — current

🟢 **Schema + writer ship with the template** (`prisma/schema.prisma` `AuditLog` + `lib/prisma/audit-extension.ts`). The Prisma extension auto-records every `create` / `update` / `delete` on every model **outside the EXCLUDE set** (`AuditLog`, `Account`, `Session`, `VerificationToken`).

- **Captured per row:** `timestamp`, `entityType`, `entityId`, `action` (`CREATE` / `UPDATE` / `DELETE` / `RESTORE`), `before` (JSON snapshot pre-write, scrubbed), `after` (JSON snapshot post-write, scrubbed), `changes` (diff with `updatedAt` excluded; scrubbed fields show as `from: [redacted], to: [redacted]`), `userId` (from `AuditContext`), `ipAddress`, `userAgent`.
- **Soft-delete detection:** an `update` that sets `deletedAt` from null is rewritten as `action: "DELETE"`; an update that clears `deletedAt` is `action: "RESTORE"`.
- **Attribution comes from `AuditContext`** seeded by `withAuth` / `withAdminAuth`. Calls outside the wrappers (`withInternalAuth` endpoints, cron jobs, seed scripts) attribute to `null` user.
- **Restricted-field scrubbing:** `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` replaces values for `passwordHash`, `password`, `refresh_token`, `access_token`, `id_token`, `session_state`, `sessionToken`, `token`, `secret`, `apiKey`, `api_key`. The contract suite (`tests/contracts/audit-scrub.test.ts`) asserts the membership and behavior.
- **Retention:** 🟢 `app/api/internal/audit-purge` deletes rows older than `AUDIT_RETENTION_DAYS` (default 365). Called monthly by `.github/workflows/audit-retention.yml` at 03:00 UTC on the 1st, gated by `AUDIT_PURGE_TOKEN`. The endpoint returns 503 if the token is unset; the workflow skips with a warning. **Forks set `AUDIT_PURGE_TOKEN` and `PROD_BASE_URL` in `/first-fork` step 3.**
- **Append-only:** enforced at the application layer. No DB-level `REVOKE` is set.

---

## 6. Secrets

| Secret | Today | Notes |
|---|---|---|
| `AUTH_SECRET` | `.env` (Restricted) | JWT signing key. Rotation invalidates every session. `openssl rand -base64 32`. |
| `POSTGRES_PASSWORD` | `.env` / Portainer stack (Restricted) | DB superuser-equivalent. Rotation requires DB lockout coordination. |
| `MINIO_ROOT_PASSWORD` / `MINIO_SECRET_KEY` | `.env` (Restricted) | Rotation invalidates every presigned URL in flight. |
| `MINIO_ROOT_USER` / `MINIO_ACCESS_KEY` | `.env` (Confidential) | Rotate as a unit with the secret half. **Forks should mint a scoped MinIO user during `/first-fork` step 7 and use the scoped credentials in the app, not the root.** |
| `SEED_ADMIN_PASSWORD` | `.env` (Restricted) | One-shot bootstrap. Rotate on first login or remove the seed call after initial deploy. |
| `AUDIT_PURGE_TOKEN` | `.env` + repo secret (Restricted, optional) | Gates `/api/internal/audit-purge`. `openssl rand -base64 48`. |
| `BACKUP_AGE_IDENTITY` | GitHub repo secret only (Restricted) | age private key for decrypting backups. **Never** on the host. |
| `RCLONE_CONFIG` | GitHub repo secret (Restricted) + host `/opt/backup/rclone.conf` mode 600 | Contains the remote target's API credentials. |
| `RCLONE_REMOTE` / `BACKUP_BUCKET` | repo secret + Portainer stack (Confidential) | Remote name + bucket. |
| `BACKUP_ENABLED` | Portainer stack (Internal) | Set to `true` after rclone + age are configured to wake the backup sidecar. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | `.env` (Restricted — only if OAuth enabled) | Rotate from Google Cloud Console. |
| `DATABASE_URL` | `.env` (Confidential — embeds the password) | Reconstruct from `POSTGRES_*` rather than logging the URL. |
| `IMAGE_TAG` | Portainer stack env (Internal) | Optional. Set to `sha-<short>` to pin prod to a specific build. Defaults to `latest`. |
| `PORTAINER_WEBHOOK_URL` | GitHub repo secret (Restricted) | Anyone with this URL can trigger a redeploy. **Use a stack webhook** so the SHA query string is honored. |
| `PROD_BASE_URL` | GitHub repo secret (Confidential) | Used by `audit-retention.yml` to know where to POST. |
| GHCR push token | `GITHUB_TOKEN` (Restricted — managed by Actions) | Inherits the workflow token. |
| `DO_API_TOKEN` | GH repo secret (Restricted) | DigitalOcean PAT — full-account scope (DO has no fine-grained PATs). Used by `deploy.yml` / `new-project.yml` to provision Droplets, reserved IPs, Spaces. **Use a dedicated automation DO account isolated from billing-owner.** Per ADR-004: the token now lives only in the repo's GitHub secrets — it never traverses Claude chat or the operator's shell during normal use. |
| `CLOUDFLARE_API_TOKEN` | GH repo secret (Restricted) | Cloudflare API token scoped to `Zone.DNS:Edit` on one zone. Used by `deploy.yml` / `new-project.yml` to upsert A records. Per ADR-004: GH repo secret, not operator-side. |
| `GH_AUTOMATION_TOKEN` | GH repo secret (Restricted) | GitHub PAT with `repo` + `workflow`. Used by ops workflows to set secrets on the forked repo, push to `deployment-state`, etc. Falls back to `GITHUB_TOKEN` (in-workflow) if unset, which lacks cross-repo scope. Per ADR-004. |
| `SSH_PRIVATE_KEY` | GH repo secret (Restricted) | ed25519 private key the deploy / new-project workflows install into the runner's `~/.ssh/id_ed25519` to reach the Droplet for Portainer install. Generated fresh per project; **never** an operator's personal key. Per ADR-004. |
| `SENTRY_AUTH_TOKEN` | GitHub repo secret (Restricted) | CI-only. Used by `docker-build.yml` to upload source-maps to Sentry on each main-branch build. Scope: `project:releases` + `org:read`. Missing token → upload step skips silently; app still runs. See ADR-002. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | GH repo + Portainer stack (Public) | Per-project Sentry DSN. **Not classified as Restricted** — Sentry DSNs are designed by Sentry to ship in client bundles. Documented here for clarity / completeness. See ADR-002. |
| `SENTRY_ORG` / `SENTRY_PROJECT` | GitHub repo **vars** (Public) | Sentry org / project slugs. Repo vars (not secrets) so they're configurable per fork without exposing the token. |
| `BETTER_UPTIME_API_KEY` | GH repo secret (Restricted) | Used by `deploy.yml` to POST a Better Uptime monitor against `https://<domain>/api/health` and to DELETE it on `action=destroy`. Holder can read / write / delete every monitor on the account — keep scoped to a project-specific Better Stack team. Per ADR-004: now a repo secret (was operator-shell-only before the CI pivot). See ADR-002. |

**The `deployment-state` orphan branch (per ADR-004):** Workflows commit
`.deploy-state.<env>.json` files to a long-lived orphan branch named
`deployment-state`. The branch carries **resource IDs** (DO Droplet IDs,
reserved IP, Spaces bucket name, Cloudflare zone+record ID, Portainer stack
ID, Better Uptime monitor ID, GitHub repo metadata) plus the Portainer
**stack webhook URL** and the **Portainer admin password** that
`deploy.mjs` mints during install (the URL and password are needed for
subsequent rollback / redeploy runs to authenticate against Portainer).
Repo collaborators with read access can see this branch. Treat the branch
as **Confidential** for any repo where Portainer admin equals control of
the deployed app; restrict repo read access accordingly, or move the
Portainer admin password to a per-env GH environment secret in a follow-up
ADR if the threat model demands it. The branch carries **no** DO / CF / GH
/ Sentry / age / rclone credentials — those stay in repo secrets only.

**Rotation log:** (downstream projects record every rotation event here)

| Date | Secret | Reason | Operator |
|---|---|---|---|
| — | — | — | — |

Rotate any secret after any chat-history-with-secret event. Rotating must never require a code change.

`.env.example` lives in git. `.env` never does. ✅ (enforced by gitleaks)

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

### T3 — MinIO presigned URL leak
- **Control:** short expiry (1h default) ✅; never log presigned URLs ✅ (project-enforced); restrict bucket policy via scoped key in `/first-fork` step 7 — forks that skip this run on the MinIO root key (finding T-09).

### T4 — Compromised Portainer webhook
- **Control:** stored as GitHub repo secret ✅; webhook carries `?IMAGE_TAG=sha-<short>` so stack-webhook deployments pin to the build SHA ✅; rotate in Portainer if leaked.

### T5 — Host compromise
- **Blast:** full exfil of `AUTH_SECRET`, `POSTGRES_PASSWORD`, `MINIO_*`, every `passwordHash`, every uploaded file, every audit row. **But not the prior backups** — the age identity is in GitHub repo secrets, not on the host.
- **Control:** project-specific host hardening. Backup identity isolation ✅ (prior backups remain decryptable only with `BACKUP_AGE_IDENTITY` repo secret).

---

## 8. Incident response

Project-specific. Template stub: rotate the suspected secret, take the public hostname offline at the reverse proxy or DNS, snapshot the host volumes, page the on-call. Filled in per fork.

---

## 9. Compliance baseline

Project-specific. The template is unclassified. PDPL / GDPR / sector-specific posture documented in the fork's first project ADR (`/adr` step 11 of `/first-fork`).

---

## 10. OWASP Top 10 — template coverage

| Risk | Coverage |
|---|---|
| A01 Broken Access Control | `withAuth` / `withAdminAuth` / `withInternalAuth` boundary ✅; middleware enforces auth on every non-public path ✅. |
| A02 Cryptographic Failures | TLS at reverse proxy (out of template) ⚠️; HSTS ✅; bcryptjs ✅; encrypted backups via age ✅. **Strengthened by ADR-004:** all vendor API tokens (DO, CF, GH, Better Uptime, Sentry, age identity, rclone) now live as GH repo secrets and are injected directly into Actions runners. They never traverse Claude chat or the operator's shell during normal ops, eliminating the chat-transcript exfiltration vector. |
| A03 Injection | Prisma parameterizes everything ✅; zod at boundary ✅; Semgrep `p/owasp-top-ten` on every push ✅. |
| A04 Insecure Design | Audit + soft-delete + scrubbing framework-enforced ✅; rate-limit ✅; no MFA (T-02). |
| A05 Security Misconfiguration | Security headers + CSP ✅; non-root container ✅; standalone build ✅. |
| A06 Vulnerable Components | `npm audit --audit-level=high --omit=dev` in `verify.yml` ✅. |
| A07 ID & Auth Failures | Auth.js v5 + bcryptjs ✅; rate limit ✅; no MFA ⚠️ (T-02); no account lockout ⚠️. |
| A08 Software & Data Integrity | GHCR image SHA-pinning via stack webhook ✅; gitleaks blocking ✅; Semgrep blocking ✅; tested restore drill quarterly ✅. |
| A09 Logging & Monitoring | Auto-audit ✅; retention enforced via `/api/internal/audit-purge` ✅; Sentry SaaS (opt-in per project, ADR-002) ✅; Better Uptime SaaS for `/api/health` (opt-in per project, ADR-002) ✅; no Prometheus / metrics yet ⚠️. |
| A10 SSRF | No outbound HTTP from the app by default. |

ASVS Level 2 is a reasonable target once T-02 (MFA) and T-09 (scoped MinIO key per fork) are closed.

---

## 11. Findings SLAs

| Severity | SLA |
|---|---|
| Critical | 7d (feature-flag off if not patched) |
| High | 30d |
| Medium | 90d |
| Low | best-effort |

| ID | Severity | Status | Title | Notes |
|---|---|---|---|---|
| T-01 | High | ✅ Closed (`e16a8c6`) | No rate limit on `/api/auth/*` | In-memory bucket, 10/min/IP. Horizontally-scaled forks swap to `@upstash/ratelimit`. Contract suite asserts. |
| T-02 | High | Open | No MFA | Deferred — product decision (WebAuthn / TOTP / front with SSO). |
| T-03 | High | ✅ Closed (`bb4918a`) | `passwordHash` snapshotted into `audit_logs` on user update | `SCRUB_FIELDS` redacts. Contract suite asserts. |
| T-04 | Medium | ✅ Closed (`104bc45`) | GHCR image tag pinned to `:latest` | Resolves through `${IMAGE_TAG:-latest}`; CI passes `?IMAGE_TAG=sha-<short>` on the webhook. Opt-in to SHA pinning via Portainer **stack** webhook. |
| T-05 | Medium | ✅ Closed (`de555fb`) | No CSP header | Conservative policy in `next.config.ts`. Caveats in §4. |
| T-06 | Medium | ✅ Closed (`2aa745f`) | No audit-log retention policy | `/api/internal/audit-purge` + monthly `audit-retention.yml`. |
| T-07 | Medium | ✅ Closed (`c5a6279`) | No encrypted backup pipeline | age + rclone sidecar; quarterly `restore-test.yml`. |
| T-08 | Low | ✅ Closed (`bf5b542`) | `session.user.role` typed as `any` | `next-auth` `User` augmented in `types/index.ts`; `lib/auth.ts` cast-free. |
| T-09 | Low | Per-fork (closed in `/first-fork` step 7) | MinIO uses root credentials in the app | Template ships with root; `/first-fork` mints a scoped key per fork. |

**No-Critical/High gate before production.** An open finding blocks release unless a time-bound risk acceptance is documented here by the project owner.

---

## 12. Suppression log

Every SAST / SCA / secret-scan suppression appears here with rule ID, location, justification, reviewer, and date. **Never** bare `// nosem` or path-based gitleaks allowlists.

| Date | Tool | Rule | Location | Justification | Reviewer |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

---

## 13. Tracked CVE remediations

| Date | Package | Bump | CVE | Outcome |
|---|---|---|---|---|
| — | — | — | — | — |

---

## 14. CI security gates

Five workflows gate the repo. None require local action.

| Workflow | Triggers | What it gates | Blocks on |
|---|---|---|---|
| `verify.yml` | PR + push (non-main) | `tsc --noEmit`, ESLint, `node:test` contract suite, `next build`, `npm audit --audit-level=high --omit=dev`, scaffold smoke | High+ CVE in a production dep, typecheck error, lint error, test failure, build failure, scaffold breakage |
| `secrets-scan.yml` | PR + push (any) | gitleaks across full git history | Any detected secret pattern |
| `sast.yml` | PR + push (any) | Semgrep with `p/javascript`, `p/typescript`, `p/nextjs`, `p/react`, `p/owasp-top-ten`, `p/secrets` | Any finding at default severity |
| `audit-retention.yml` | Monthly cron (`0 3 1 * *`) + dispatch | POST `/api/internal/audit-purge` with `AUDIT_PURGE_TOKEN`; deletes rows older than `AUDIT_RETENTION_DAYS` | Non-200 from the endpoint; warns + skips if secrets unset |
| `restore-test.yml` | Quarterly cron (`0 3 1 1,4,7,10 *`) + dispatch | Pull newest backup from rclone remote, decrypt with `BACKUP_AGE_IDENTITY`, restore into ephemeral Postgres, assert `count(users) > 0` | Empty `users` after restore = broken backup chain; warns + skips if secrets unset |

Pushes to `main` go through `docker-build.yml` instead — if the build fails (which exercises the same compile path as `verify`), the Portainer webhook is not called and production does not redeploy.

**Enable branch protection on `main`** during `/first-fork` step 10 to require `Verify`, `Secrets scan`, `SAST` checks before merge. The template ships the workflows but cannot configure rulesets on forks.

---

## 15. Test coverage gates

The contract suite (`tests/contracts/*.test.ts`, run via `node:test` + `tsx`) covers the highest-risk invariants. Failures block `verify.yml` and therefore block merge.

| Module | Test file | Covers |
|---|---|---|
| `lib/rate-limit.ts` | `tests/contracts/rate-limit.test.ts` | Allow within window, block past limit, separate buckets per `id`, separate buckets per IP, `x-real-ip` fallback, window expiry resets bucket |
| `lib/prisma/audit-extension.ts` (the `scrub` + `computeChanges` + `SCRUB_FIELDS` exports) | `tests/contracts/audit-scrub.test.ts` | Per-field redaction, non-scrubbed pass-through, null/undefined edge cases, change detection, `updatedAt` skip, no-op detection, unscrubbed verbatim, `SCRUB_FIELDS` membership |

Deliberately not covered yet (would need disproportionate Prisma / Auth.js mocking for the value): `withAuth` / `withAdminAuth` / `withInternalAuth` HOFs, soft-delete extension behavior. These are smoke-tested by every entity that uses them; explicit unit tests are a future bucket.

**Adding a new Restricted field-name to `SCRUB_FIELDS`?** Add it to the membership assertion in `tests/contracts/audit-scrub.test.ts` in the same commit, or future contributors lose the assertion that the field is scrubbed.
