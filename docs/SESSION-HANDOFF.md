# Session handoff — Rihal Aptitude Platform

**Branch:** `claude/rihal-phase-5-invitations-b2zaau` (push verified; `git rev-list --count @{u}..HEAD` = 0).
**Operator goal:** Build the platform in ARCHITECTURE.md §12's 8 phases, **pausing for operator review after each phase.** Specs (ARCHITECTURE.md, UI-SPEC.md) are session UPLOADS, NOT in the repo — re-request before any phase needing detail.

## Status: Phases 1–5 DONE + Phase-5 `/ship` GREEN. ⏸ PAUSED for operator review before Phase 6 (results/scoring roll-up + AI Role 2).

### Branch note (read first)
The branch `claude/rihal-phase-5-invitations-b2zaau` was created off **bare template** (== `origin/main`, 0 commits ahead) — it did NOT contain Phases 1–4. The Phase 1–4 source of truth was `origin/claude/rihal-phase-4-qa-gates-lufmik` (tip `dbe27c7`, 24 commits ahead of main). This session **fast-forwarded** the phase-5 branch onto `dbe27c7` (clean FF — phase-4 was strictly ahead; non-destructive) and built Phase 5 on top. If a future session finds a Rihal branch that looks like bare template, check `git log --all --oneline | grep phase` for the real tip.

### Phase 5 — Invitations (ARCHITECTURE §12.5, UI-SPEC D.5) — built this session
- **Token hash-at-rest (Phase-5 prerequisite, was scheduled — now FIXED).** `invitations.token` → `tokenHash = HMAC-SHA256(rawToken, TOKEN_HMAC_KEY)` (`lib/token.ts`), unique-indexed. The RAW token lives ONLY in the emailed `/a/<token>` link, never persisted; `resolveToken` re-hashes the presented token and looks up by hash. Added to `SCRUB_FIELDS` + `RESTRICTED_EXPORT_KEYS` (lockstep drift tests green). `TOKEN_HMAC_KEY` Restricted env (falls back to `AUTH_SECRET`). Migration `20260627120000_hash_invitation_token` (column rename, pre-launch so no real tokens lost). SECURITY.md §1 updated.
- **Service** `lib/services/invitation.ts`: `listInvitations` (tenant-scoped, paginated, status filter honors *effective* status incl. derived EXPIRED), `createInvitation` (single), `createInvitationsBulk` (one batchId, per-recipient results, MAX_BATCH=500), `resendInvitation` (ROTATES the token — old link dies; blocks STARTED/COMPLETED/REVOKED), `revokeInvitation` (→ REVOKED → runner 403), `markOpened` (PENDING→OPENED beacon), `effectiveStatus`.
- **Validations** `lib/validations/invitation.ts`: single/bulk zod + `parseRecipients` (client-safe paste/CSV parser: dedupe, invalid flags, header skip, single-line `email,name` disambiguation) + `INVITATION_STATUSES` (client-safe enum mirror) + `RecipientResult` type (client-safe).
- **Routes:** `app/api/invitations/{route,bulk,[id]/resend,[id]/revoke}` (withAdminAuth + withRateLimit OUTSIDE; GET list withManagerAuth) + `app/api/run/[token]/opened` (withCandidateToken beacon).
- **UI** `app/[locale]/app/invites/`: list page (replaces placeholder; TanStack-spec'd but built on the shared shadcn Table per Phase-3 precedent), `SendInvitesPanel` (Sheet, single/bulk toggle, CSV upload, live preview, per-recipient results, over-limit gating), `InvitationActions` (resend/revoke islands), `InvitationStatusBadge`, `InvitesFilter`. i18n `invitations` namespace in en + ar. Runner gained the OPENED beacon (`app/a/[token]/Runner.tsx`).
- **Email:** reuses the existing SMTP seam (`lib/email.ts`) — bilingual invite body, metadata-only logging. No new dep (operator chose SMTP over Resend; Resend is a later `/scale-up` swap).

### Decisions resolved this session (AskUserQuestion, 2026-06-27 — see docs/findings-register.md)
1. **Audit scope for candidate answers → KEEP AUDIT ON.** Phase-4 autosave stays find-then-create (no upsert, no EXCLUDE set, no ADR). Register line adjudicated.
2. **Email provider → existing SMTP seam** (not Resend now).

### Code-review (high effort) findings — fixed before /ship
EXPIRED status filter now consistent with the displayed badge (`statusWhere` maps effective→stored); over-MAX_BATCH now gates submit + shows a proper message (not "invalid"); send-panel mode toggle is an honest `role=group`/`aria-pressed` segmented control (was an incomplete ARIA tabs widget); pagination renders a truly-inert disabled Button at boundaries (was a still-focusable `<a>`); single-line `email,name` parses correctly. Accepted (documented): a created-but-email-failed invite is recovered via per-row Resend, not bulk re-run (blocking a duplicate is correct).

### Gate status
`/blueprint` (full track, committed `docs/blueprints/phase-5-invitations.md`) → `/code-review` (high) → `/ship` GREEN (typecheck+lint+tests+component+scalability+wave-offs+tier+blueprint+build+gitleaks+npm audit). **senior-code-reviewer runs post-push (next).**

### Local run recipe (proven; PG16 :5433)
- `mkdir -p /tmp/pg5/data && chown -R postgres:postgres /tmp/pg5` → `runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D /tmp/pg5/data -U postgres --auth=trust` → `cd /tmp && runuser -u postgres -- $PGBIN/pg_ctl -D /tmp/pg5/data -o "-p 5433 -k /tmp/pg5" -w start` (NOTE: `-w start` blocks the tool 2min — the cluster still starts; verify with `pg_ctl status`, then `createdb -p 5433 -h /tmp/pg5 appdb`).
- `export DATABASE_URL="postgresql://postgres@localhost:5433/appdb?schema=public"` → `npx prisma migrate deploy` + `SEED_ADMIN_EMAIL=hr@rihal.test SEED_ADMIN_PASSWORD='Passw0rd!demo' npm run prisma:seed`.
- **STALE-DEPS GOTCHA (cost real time this session):** after FF-ing onto a branch whose `package.json` moved ahead, `npm install` AGAIN before typecheck/build — else tsc reports phantom "Cannot find module 'lucide-react'/'react-hook-form'/cva" across the whole repo.
- For `/ship` build: `NODE_ENV=production` + the local `DATABASE_URL` (+ `AUTH_SECRET` from `.env`).
- Generated Prisma client import path: `@/generated/prisma/client`. `generated/` is read-denied to the agent — query via `psql` (camelCase columns, quote them) or a tsx script.
- **Client/server boundary gotcha:** a `"use client"` component must NOT import a runtime value from `@/generated/prisma/client` (pulls `node:module` → Turbopack build error). Use `import type` for enums, or a client-safe mirror const (e.g. `INVITATION_STATUSES` in `lib/validations/invitation.ts`).

### Next: Phase 6 — Results + dashboards + AI Role 2 (ARCHITECTURE §12.6, UI-SPEC D.6/D.7)
Scoring roll-up (call the `services/scoring` FastAPI microservice — see `lib/scoring.ts`), fit score, competency/trait decomposition (radar + bars), SJT judgement, the AI narrative summary (AI Role 2, numbers-bound, `lib/llm.ts` seam), candidate compare, PDF export, decision capture. Do `/blueprint` (full track) first; re-request ARCHITECTURE/UI-SPEC uploads.
