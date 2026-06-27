# Findings register (wave-offs must be logged, never silent)

Every time a finding is **not fixed** — deferred, accepted as a known limitation,
declared an intentional trade-off, a "judgment call" handed to the operator, a
skipped QA phase, or a lint/rule suppression — it gets a dated line here. The
point is that "acceptable" is a recorded, reviewable decision, not a silent
shrug (complaint #12). `/qa` refuses to green a release while a wave-off touching
the changed surface is still **open** (un-adjudicated).

- **Security** suppressions (gitleaks / Semgrep / npm-audit / an ESLint security
  rule) go in **SECURITY.md §12**, not here — this register is for the rest
  (the four non-security pillars, UX/design judgment calls, skipped QA phases,
  deferred functionality).
- One line per wave-off. Newest at the top.
- Format: `YYYY-MM-DD — [pillar/area] <finding> — WHY waived — <owner/operator> — status: open | adjudicated(<date>) | fixed(<commit>)`
- A wave-off is **open** until the operator adjudicates it (accepts or schedules
  it) or it's fixed. Don't mark something adjudicated on the operator's behalf.

## Register
<!-- newest first -->
- (none open)

### Operator decision RESOLVED (Phase 4 audit scope — adjudicated 2026-06-27)
- 2026-06-27 — [secure/scalable] **Audit ON for every candidate answer** (`ItemResponse`
  + `SjtResponse` writes audited with a NULL actor) — ~120 IPIP rows + SJT rows per sitting.
  **Operator chose: KEEP AUDIT ON** (AskUserQuestion, 2026-06-27). Phase-4 autosave stays
  find-then-create (no `upsert`, no EXCLUDE-set change, no ADR). The more auditable / PDPL-
  defensible option; no pillar violated. — owner: operator — status: adjudicated(2026-06-27)

### Phase-5 prerequisite RESOLVED (token hash-at-rest — fixed this session)
- 2026-06-27 — [secure] **`invitations.token` was stored plaintext → now HASH-AT-REST.**
  Before Phase 5 bulk-generated + emailed tokens (token count + blast-radius jump; threat
  T-04 = DB read). FIXED: renamed `invitations.token` → `tokenHash`
  (`HMAC-SHA256(rawToken, TOKEN_HMAC_KEY)`, `lib/token.ts`), unique-indexed; the raw token
  lives only in the emailed link and is never persisted; `resolveToken` looks up by hash.
  Added to `SCRUB_FIELDS` + `RESTRICTED_EXPORT_KEYS` (lockstep tests green). `TOKEN_HMAC_KEY`
  Restricted env (falls back to `AUTH_SECRET`). Migration `20260627120000_hash_invitation_token`.
  — owner: operator — status: fixed(3c9c0cb)

### Senior-review findings RESOLVED this session (2026-06-27, commit pending — Phase-4 runner)
- P2002 race on concurrent double-consent → was an unhandled 500 for a mobile
  double-tap; now caught + returns the winning assessment (`recordConsent`).
- `getInvitationDisplay`/`getSavedResponses` were org-unscoped (latent IDOR, not
  reachable today); now `orgId`-scoped (`findFirst` + `assessment:{orgId}` filter).
- Consent route returned 200 on an already-SUBMITTED sitting; now 409.
- `withCandidateToken` docstring "uniformly" clarified; `invitations.token` added to
  SECURITY.md §1 Restricted.
- Verified SOUND by the senior pass (no change needed): token enumeration/timing,
  Referer leakage, write-path tenancy, scoringKey exclusion, XSS (no dangerouslySetInnerHTML),
  CSP nonce on `/a`, pre-consent/post-submit guards, PDPL consent-before-data.

### Resolved 2026-06-27 — Phase-4 candidate-runner design-QA (axe AA on `/a/*`, EN+AR, light+dark, mobile)
Browser design-QA on the candidate runner (the first PUBLIC surface): axe (wcag2a/2aa/21a/21aa)
across consent/items/SJT/completion × EN + AR-RTL × light + dark + mobile@360px + the
save-error state + reduced-motion. Started with 5 distinct serious `color-contrast` defects;
ended GREEN on all 16 screen/mode combinations. What was FIXED (not waived), all in
`app/globals.css` tokens + the 7 runner components:
- The azure accent (`#2e7da6`) used as TEXT was sub-AA: the methodology link on the mist
  tint (3.99:1) and the SJT "Scenario" heading on the dark card (3.81:1). Added a
  text-tuned `--accent-ink` token (light `#1b6485`, dark `#5aa9d1`; ≥4.5:1 on paper/card/
  tint) and pointed the link + heading + wordmark(dark) at it.
- Dark-mode tinted surfaces used a FIXED light brand literal `bg-[var(--rihal-mist)]`, so
  the consent block / selected Likert / selected SJT option / completion badge put light
  semantic text on a light fill in dark (6 nodes on consent alone). Swapped to the
  mode-aware `bg-secondary` (identical mist in light; deep navy in dark) — light unchanged.
- The shared shadcn primary button was sub-AA in dark (dark label `#07131e` on azure
  `#2e7da6` = 4.10:1) — a latent app-wide dark bug surfaced by the runner's Next/Begin.
  Lightened dark `--primary`/`--sidebar-primary` to `#3a8cb8` (label → 5.0:1).
- The inline save-error / retry copy (`text-destructive`) was sub-AA in dark (`#c4604b`
  on the card = 4.25:1). Added `--destructive-ink` (light `#a8472f`, dark `#e08a73`) for
  destructive-as-text and used it in `SaveIndicator` + the consent error alert.
Reduced-motion is correctly honored (the global `prefers-reduced-motion` rule pins
transition-duration to 0.001ms = imperceptible) — verified, no change needed.

### Resolved 2026-06-26 — design-QA a11y pass (authenticated local carbon-copy)
Ran the axe gate (`tests/uat/a11y.full.uat.ts`, full mode) against every dashboard
screen authenticated. Started RED (all 6 screens had serious/critical violations);
ended GREEN (all 6 pass). What was FIXED (not waived):
- color-contrast (serious, every product screen): AntD's stock muted-text tiers
  (`colorTextDescription`/`colorTextTertiary` ≈ #8c8c8c ~3.4:1; placeholders +
  empty-table text via `colorTextQuaternary` ≈ #bfbfbf ~1.8:1) fell below WCAG AA.
  Darkened the tiers in `components/layout/antd-theme.ts` (light + dark) and lifted
  the table/empty-state text in `app/globals.css`.
- label (critical): audit-log filter Selects, style-guide bare inputs, and the
  DataView row-selection checkboxes were unnamed — added `aria-label` / `getCheckboxProps`.
- button-name (critical): style-guide Switches rendered as unnamed `<button role=switch>` — added `aria-label`.
- svg-img-alt (serious): dashboard pie sectors (recharts role="img" without a name) —
  named each `<Cell>`; dropped the pie `label` to remove the prohibited label-line path.

## Standing wave-offs promoted to documented trade-offs
<!--
When a wave-off is a permanent, intentional design choice (not a deferral), it
graduates out of the live register into a documented "known trap" in CLAUDE.md or
an ADR — then delete its line above. These are the already-documented ones, kept
here as pointers so they aren't re-litigated as new findings:
-->
- File uploads not wired; PDF export intentionally absent from `lib/export.ts` (ADR-006).
- Rate limiter is in-memory per-instance (fine single-instance; Upstash via `/scale-up`).
- CSP allows `'unsafe-inline'` script+style (AntD SSR + Next bootstrap).
  (See CLAUDE.md "Known traps" for the full list.)
- The **style-guide** route is exempt from the axe `color-contrast` rule
  (`tests/uat/a11y.full.uat.ts`, `isTokenShowroom`). It is a deliberate token SHOWROOM
  (not in the sidebar nav) that renders the raw AntD preset palettes (Tag green/gold/red),
  the semantic Typography types (warning/success/danger as inline text), and brand
  swatches ON PURPOSE — several ship below AA as demos; "fixing" them would hide what the
  page exists to show or force a brand-palette change. Its structure is still gated
  strictly (label/button-name/svg-img-alt enforced there); every PRODUCT screen carries
  NO contrast exemption and is axe-clean. Rationale lives in the spec comment.
- Disabled input/Select placeholders now render at active-placeholder contrast (the
  `colorTextPlaceholder` token was lifted to AA). Intentional AA-first choice; disabled
  state is still signalled by the disabled border + background. Don't re-litigate.
- DataView row-selection checkboxes share one generic accessible name ("Select row").
  axe-clean (label present), but not row-unique; a future a11y pass could thread a
  per-row label accessor for screen-reader correlation. Net improvement over prior (no name).
- Dashboard "Users by role" pie shows a pac-man wedge with degenerate single-role seed
  data (1 ADMIN) — a cosmetic recharts artifact of a single 100% slice; fills in with
  real multi-role data. Not a defect.

### Phase-3 role-profile authoring (senior-review 2026-06-27 — accepted design calls)
- **One-ACTIVE-per-lineage is enforced in the app approve flow, not by a DB partial
  unique index.** `approveRoleProfile` archives the prior ACTIVE then activates the new
  version (sequential, deliberately NOT a `$transaction` — the audit extension writes via
  the outer client, so a tx would push the audit row outside it). A `(orgId,lineageId)
  WHERE status='ACTIVE'` partial unique index would harden against a two-admins-approve-
  the-same-lineage-simultaneously race, but Prisma can't express partial indexes in-schema
  (raw SQL → migrate drift in a `migrate deploy` repo). Mitigation: the race is rare (two
  concurrent approvals of two DRAFTs of the *same* lineage), the normal flow is self-healing
  on retry, and **Phase 4+ resolves "the active profile" deterministically (highest version,
  take 1)** so a transient double-ACTIVE never makes scoring ambiguous. Revisit (raw-SQL
  index, accept the drift) if it ever manifests.
- **`RoleProfileStatus.APPROVED` is currently unreachable.** Per UI-SPEC D.3 step 5
  approval is a single "Approve & activate" action (DRAFT/IN_REVIEW → ACTIVE), so APPROVED
  has no transition into it today. Retained in the enum for a possible future two-approver
  workflow; no code relies on it. Not a defect.
- **Child writes (Competency/CompetencyFacet/SjtItem) are audited at the parent/version
  level, not per child.** They're nested relation writes inside the parent RoleProfile op,
  so the audit extension records the parent CREATE/UPDATE (actor/timestamp/orgId) but not a
  discrete row per child. Full *content* history is preserved by immutable versioning
  (APPROVED/ACTIVE never mutate; revising clones a new DRAFT). Adequate PDPL trail for the
  tier; a `shared` fork with stricter obligations can add explicit `recordAudit` calls.
