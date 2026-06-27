# Session handoff — Rihal Aptitude Platform

**Branch:** `claude/rihal-phase-4-qa-gates-lufmik` (tip pushed; `git rev-list --count @{u}..HEAD` = 0).
**Operator goal:** Build the platform in ARCHITECTURE.md §12's 8 phases, **pausing for operator review after each phase.** Specs (ARCHITECTURE.md, UI-SPEC.md) are session UPLOADS, NOT in the repo — re-request before any phase needing detail.

## Status: Phases 1–4 DONE + all Phase-4 QA gates GREEN. ⏸ PAUSED for operator review before Phase 5 (invites).

### Branch note (read first)
`claude/rihal-phase-4-qa-gates-lufmik` was created off **template** commits, not the Phase-4 work. The Phase-4 build lived on `claude/rihal-phase-4-candidate-runner-3r3ix6` (tip `fe9a1ab`). The qa-gates branch had zero unique commits (a strict ancestor), so this session **fast-forwarded** it onto `fe9a1ab` — non-destructive — and ran the gates on top. The qa-gates branch is now the source of truth (Phases 1–4 + gate fixes). Flagged to the operator.

### Phase-4 QA gates — ALL GREEN this session (commits `18d6f1f`, `b9f76ed`)
1. **Browser UAT of `/a/<token>`** — happy path (consent gated on checkbox → 120 paged autosaved items → SJT → completion/submit → resume-to-first-unanswered) + worst paths ALL pass: invalid/revoked/expired/completed token screens; write-before-consent **409**; out-of-range value & itemNumber **422**; unknown SJT item/option **422**; `consent:false` **422**; post-submit write **409**; save-failure → inline retry → recovers. Drove via the repo Playwright runner (`executablePath: /opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
2. **/design-qa on `/a/*`** — axe AA clean on **all 16** screen/mode combos (consent/items/SJT/completion × EN + AR-RTL × light + dark), + mobile@360px (44px targets) + save-error state + reduced-motion. Started RED: fixed **5 serious contrast defects** (azure-as-text < AA; fixed-light `bg-[var(--rihal-mist)]` tiles carrying light text in dark; shared dark primary-button label 4.10:1; dark error text 4.25:1). Fixes are token-level: new `--accent-ink` + `--destructive-ink`, lightened dark `--primary`/`--sidebar-primary` to `#3a8cb8`, mist→`bg-secondary` swaps. **Light mode visually unchanged.**
3. **senior-code-reviewer** on the Phase-4 diff — ran, findings ALL resolved in `b9f76ed`: P2002 double-consent 500 → caught; `getInvitationDisplay`/`getSavedResponses` org-scoped; consent-on-submitted → 409; `invitations.token` → Restricted (SECURITY.md §1); docstring nit. Verified SOUND: token enumeration, scoringKey exclusion, XSS, CSP nonce, write-path tenancy, PDPL consent-before-data.
4. **/code-review + /ship GREEN** before each push.

### ⚠️ OPEN operator decision (in docs/findings-register.md — NON-blocking, /ship is green)
**Audit ON for every candidate answer?** The runner audits each IPIP/SJT write (~120 null-actor rows/sitting). Faithful to the blueprint + the *more* auditable choice (no pillar violated). Operator chooses: **keep audit ON**, or move `ItemResponse`/`SjtResponse` to the audit **EXCLUDE** set via an ADR (Ask-before; cuts row volume, switch autosave to `upsert`; sitting-level consent/submit audit + PDPL story stay intact). Awaiting the operator before acting.

### Scheduled (NOT due now): Phase-5 prerequisite
`invitations.token` is plaintext — fine for Phase 4. Before Phase 5 bulk-generates/emails tokens, switch to **hash-at-rest** (HMAC-SHA256 / bcrypt, index the hash, look up by hash in `resolveToken`). Logged in findings-register `status: scheduled(phase-5)`.

### Phase-4 file map (recap)
- Service `lib/services/candidateRunner.ts`; auth `lib/api-helpers.ts` `withCandidateToken`; routes `app/api/run/[token]/{consent,response,submit}`; zod `lib/validations/candidate.ts`; UI `app/a/layout.tsx` + `app/a/[token]/*` + `lib/candidate-i18n.ts`. Schema: `Invitation`/`Assessment`/`ItemResponse`/`SjtResponse` (all audited, soft-delete + recycling-bin). Blueprint: `docs/blueprints/phase-4-candidate-runner.md`.

### Local run recipe (proven; PG16 :5433)
- `mkdir -p /tmp/pg4/data && chown -R postgres:postgres /tmp/pg4` → `runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D /tmp/pg4/data -U postgres --auth=trust` → `cd /tmp && runuser -u postgres -- $PGBIN/pg_ctl -D /tmp/pg4/data -o "-p 5433 -k /tmp/pg4" -w start` → `createdb -p 5433 -h /tmp/pg4 appdb`. (`rm -rf` deny-listed — use a fresh dir.)
- `export DATABASE_URL="postgresql://postgres@localhost:5433/appdb?schema=public"` → `npx prisma generate` + `migrate deploy` + `SEED_ADMIN_EMAIL=hr@rihal.test SEED_ADMIN_PASSWORD='Passw0rd!demo' npm run prisma:seed`.
- **GOTCHA:** start dev WITH `DATABASE_URL` (+ `AUTH_TRUST_HOST=true AUTH_URL=http://localhost:3000 AUTH_SECRET=<.env>`), else `/a/*` 500s in `resolveToken`.
- Generated Prisma client import path: `../../generated/prisma/client` (NOT `generated/prisma`). `generated/` is read-denied to the agent — query the DB via `psql` (columns are camelCase, quote them) or a tsx script.
- Mint a test token: `prisma.invitation.create` against an ACTIVE profile (Support = `cmqw3kqom…`, but ids regenerate per seed) with `token: randomBytes(32).toString("base64url")`. Starter profiles ship **0 SJT items** and items have **0 AR translations** (runner falls back to EN) — add locally for full SJT/AR testing. Drive QA via the Playwright **test runner**, NOT the MCP.

### Next: Phase 5 — Invites (ARCHITECTURE §12.5, UI-SPEC D.5)
Single + bulk/CSV tokenized invitations, status tracking, email (Resend/SMTP). Do `/blueprint` (full track) first; re-request ARCHITECTURE/UI-SPEC uploads. Carry the token-hash-at-rest prerequisite into the Phase-5 build. Result/scoring roll-up is **Phase 6**.
