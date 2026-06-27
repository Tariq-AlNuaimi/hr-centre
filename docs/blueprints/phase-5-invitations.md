# Blueprint — Phase 5: Invitations

ARCHITECTURE §12.5 · UI-SPEC D.5. Builds on Phases 1–4 (tenancy/auth, item bank +
scoring, role-profile authoring, the token-authorized candidate runner).

## Problem & outcome
HR Admins need to get candidates into the assessment. Today an invitation can only
be hand-minted in a script. Phase 5 gives HR a real surface to **send tokenized
assessment links** — one at a time or in bulk (paste/CSV) — pick the role profile,
expiry, and default language, see a **per-recipient send result**, and then **track
each invitation's lifecycle** (sent → opened → started → completed → expired) with
**resend** and **revoke** controls. When this ships, an HR Admin can run a real
hiring round end-to-end up to the point of scoring (Phase 6).

A hard prerequisite ships in the same change: invitation tokens move to
**hash-at-rest** before we bulk-generate and email them (blast-radius jump; threat
T-04 = DB read). The raw token lives only in the emailed link; the DB stores an
indexed HMAC of it.

## Market scan
- **Bryq / TestGorilla / Vervoe** (commercial assessment platforms) — all ship
  bulk-invite + status tracking + reminder/resend. Confirms the feature set
  (list + filter + resend/revoke + bulk CSV + expiry) is table-stakes; none are
  adoptable (SaaS, not self-hostable, opaque). We build the thin surface.
- **Resend / Nodemailer** for transactional email — adopt (not rebuild). Decision:
  reuse the template's existing `lib/email.ts` SMTP seam (nodemailer, gracefully
  no-ops when `SMTP_HOST` unset). Resend is a later `/scale-up` swap, not a new
  dependency now (operator-confirmed).
- **TanStack Table** (spec names it for the list) — NOT adopted: Phase 3's
  role-profiles list already established the shared shadcn `Table` + server-side
  pagination pattern (senior-review accepted). Reuse it (Maintainable pillar;
  avoids an Ask-before client dep). Row actions are small client islands, mirroring
  `RoleProfileActions.tsx`.

## Tier
`personal` — matches `project.config.json`. Sets ceremony only; the security floor
(auth wrappers, zod, audit, no-secret-leak, the ESLint rules) is unchanged and
fully applied. Token hash-at-rest is a security requirement, not tier ceremony.

## User stories
- As an **HR Admin**, I want to send a single tokenized invite (email + optional
  name, role profile, expiry, default language), so that one candidate gets a link.
  - Acceptance: POST creates a `PENDING` invitation with a unique `tokenHash`,
    emails the raw-token link (or reports `sent:false` when email is disabled), and
    the row appears in the list. The raw token is never persisted or returned in a
    list response.
- As an **HR Admin**, I want to paste a list of emails OR upload a CSV
  (`email,name`), see it parsed with **dedupe + invalid-email flags + a preview**,
  then confirm, so that I can invite a whole batch in one action.
  - Acceptance: parse runs client-callable + server-validated; duplicates within the
    batch and against existing **open** invitations for the same role are flagged;
    invalid emails are flagged and excluded from send; confirm creates one `batchId`
    for the batch and returns a **per-recipient result** (sent / failed / skipped).
- As an **HR Admin**, I want to **resend** or **revoke** an invitation, so that I can
  recover a lost link or stop access.
  - Acceptance: resend **rotates the token** (new `tokenHash`, old link dies),
    re-emails, and resets to `PENDING`/sent; revoke sets `REVOKED` (the candidate
    runner already maps `REVOKED` → 403). Both audited; both admin-only.
- As an **HR Admin or Hiring Manager**, I want to see the invitations list with
  status, sent date, sent-by, batch, and **filter by role/status**, so that I can
  monitor a hiring round.
  - Acceptance: tenant-scoped, bounded/paginated list; managers read it (no
    create/resend/revoke controls — server-gated, not just hidden).

## Scenarios (per story)
- **Single send — happy:** valid email + active role profile → `PENDING` row,
  email attempted, link works in the runner.
- **Single send — worst:** invalid email → 422 zod message; non-active/cross-tenant
  role profile → 400 "Unknown or inactive role profile" (never 500); manager (not
  admin) POST → 403; double-submit → idempotent-ish (a second identical send is a
  new invitation by design — documented, not a silent dup-swallow; the dedupe guard
  warns on an existing open invite for the same email+role).
- **Bulk — happy:** 50 pasted emails, 3 dupes + 1 invalid → preview shows 46 to
  send, 3 deduped, 1 invalid; confirm → 46 created under one `batchId`, per-row
  results.
- **Bulk — worst:** empty/whitespace paste → 422 "No valid recipients"; > cap (e.g.
  500) → 422 "Batch too large"; CSV with a header row / extra columns → parsed
  leniently (email column detected), bad rows flagged not fatal; partial email
  failure → per-row `failed`, the invitation still exists (retry just resends).
- **Resend — worst:** resend on a `COMPLETED`/`REVOKED` invite → 409 (nothing to
  resend); resend on another org's invite → 404 (no existence leak).
- **Revoke — worst:** revoke an already-`COMPLETED` invite → 409; revoke
  cross-tenant → 404.
- **List — worst:** unknown status/role filter value → ignored (full list), never a
  500; manager hitting a write route → 403.

## Architecture sketch
- **Entities (existing — no new models):**
  - `Invitation { orgId, roleProfileId, candidateEmail (Confidential), candidateName?,
    token→RENAMED tokenHash (Restricted, unique-indexed), status, expiresAt?, locale,
    sentById?, batchId?, soft-delete }`. Already audited + soft-delete + recycling-bin
    registered.
  - **Restricted:** `tokenHash` (SECURITY.md §1; was `token`). **Confidential:**
    `candidateEmail`, `candidateName`.
- **Token (new `lib/token.ts`):** `generateToken()` → 32 random bytes base64url (raw);
  `hashToken(raw)` → `HMAC-SHA256(raw, TOKEN_HMAC_KEY)` hex. Deterministic so the
  runner can look up by hash (bcrypt's per-value salt would forbid an indexed lookup —
  HMAC is the correct primitive for a credential you resolve by). `TOKEN_HMAC_KEY`
  Restricted env; when unset in dev, fall back to `AUTH_SECRET` so local runs work,
  and document that production sets its own.
- **Routes (method · path · wrapper · service):**
  - `GET  /api/invitations` · `withManagerAuth` · `listInvitations` (paginated,
    filters: status, roleProfileId). `withRateLimit` outside.
  - `POST /api/invitations` · `withAdminAuth` · `createInvitation` (single) —
    `{mode:"single"}`.
  - `POST /api/invitations/bulk` · `withAdminAuth` · `createInvitationsBulk` —
    parse already done client-side, re-validated server-side; returns per-recipient
    results. `withRateLimit` outside.
  - `POST /api/invitations/[id]/resend` · `withAdminAuth` · `resendInvitation`.
  - `POST /api/invitations/[id]/revoke` · `withAdminAuth` · `revokeInvitation`.
  - All writes audited automatically (Invitation is an audited model). Email send is
    a side-effect of create/resend; failure is reported per-recipient, never throws
    the route (lib/email.ts returns `{sent}`).
- **State:** DB (Prisma) for invitations; no session/client state beyond the send-panel
  form (react state in the client island). **Anti-duplication:** reuses
  `lib/email.ts`, `lib/api-helpers.ts` wrappers, `lib/pagination.ts`, the shadcn
  `Table`/`Sheet`/`Button` primitives, the `StatusBadge` pattern, and the existing
  `resolveToken` in `lib/services/candidateRunner.ts` (only its lookup field changes).
  No new settings/list surface is introduced — `/app/invites` already exists as a
  placeholder and is replaced in place (REPO-MAP: `app/[locale]/app/invites`).
- **Migrations:** one migration renaming `invitations.token` → `tokenHash`
  (`@unique`). Forward-compatible in practice: this is pre-launch (no live candidate
  links issued except hand-made dev ones), and the rename is paired with a re-seed in
  dev. The running version never reads the old `token` column after deploy (the
  candidate runner is updated in the same change). Documented in SECURITY.md §12 / the
  findings register that the rename is a deliberate breaking change to a Restricted
  column done before any real tokens exist.

## The five pillars
- **Speed:** list is an RSC read via the service (no client fetch on load); bulk parse
  is O(n) in-memory; single bounded query per route. Send panel debounces nothing
  heavy (parse is local).
- **Maintainable:** reuses every existing primitive (email, auth wrappers, pagination,
  shared UI, StatusBadge, resolveToken); no new deps; typed end-to-end; token logic
  isolated in `lib/token.ts`.
- **Scalable:** list paginates + bounds (`take`); bulk is explicitly capped
  (`MAX_BATCH`, default 500) and creates via a bounded loop (each create audited — no
  unaudited bulk write); no N+1 (role profile validated once per batch).
- **Secure:** `withAdminAuth` on every write, `withManagerAuth` on read, `withRateLimit`
  outside both; zod at every boundary; **token hash-at-rest** (Restricted); candidate
  email is Confidential and never logged (lib/email.ts logs counts only); revoke maps to
  the runner's existing 403; cross-tenant ids → 404; resend rotates the credential.
- **High-Quality:** designed empty/loading/error/partial-failure states; per-recipient
  bulk result (honest — no green toast over a failed send); RTL + dark + axe-clean;
  filter + paginate; the send Sheet mirrors the wizard's interaction quality.

## Open questions  (RESOLVED before building)
- [x] Audit scope for candidate answers (ItemResponse/SjtResponse)? →
  **Keep audit ON** (operator, 2026-06-27). Phase-4 autosave stays find-then-create;
  the findings-register line is adjudicated, no ADR/EXCLUDE change.
- [x] Email provider for invites? → **Reuse the SMTP seam (`lib/email.ts`)**
  (operator, 2026-06-27); Resend is a later `/scale-up` swap, no new dep now.
- [x] Resend behavior? → **Rotate the token** (new hash, old link dies) — the secure
  choice, consistent with hash-at-rest. Documented, not asked (locked-decision class).
- [x] Token hashing primitive? → **HMAC-SHA256** (indexed lookup by hash; bcrypt's
  per-value salt forbids that). Locked.
