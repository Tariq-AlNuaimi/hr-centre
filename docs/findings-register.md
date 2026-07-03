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
- 2026-07-03 — [maintainable] deferred-adoption #11 (specialist-agents: a stack-aware
  `nextjs-pro`/`postgres-pro`/`prisma-expert` review seed) **DROPPED** — WHY: its niche is
  already fully covered by `senior-code-reviewer` (which reads CLAUDE.md/SECURITY.md/`docs/decisions`
  and treats each `eslint-rules/*` rule at `error` as an enumerated Next.js/Prisma/Postgres invariant
  to check) plus the native `/code-review` diff gate; a specialist seed would duplicate those lenses
  by construction, violating the item's own guardrail ("must not duplicate existing reviewer lenses").
  Removed from the tracked-deferred set — re-open only if a concrete non-duplicative review niche
  appears — owner: operator — status: adjudicated(2026-07-03) dropped (session 14)
- 2026-07-02 — [secure/maintainable] pristine-flag CLEARING is best-effort (warn-only, no
  retry/ack): `new-project.mjs` reads back `project.config.json` via the GitHub Contents API
  immediately after template-`generate` (which populates the file tree asynchronously) with no
  poll/retry, and `deploy.mjs` rewrites the flag only in the local working copy and relies on the
  operator to commit. If either clear silently fails, the fork keeps `"pristine": true` and — until
  it runs `/scaffold-entity` — ships GREEN with zero domain models, narrowly reopening the bypass
  the `fixed(34f1114)` change closed (senior-review 2026-07-02, confidence 84) — WHY deferred: the
  robust fix (mirror new-project's existing env-propagation retry loop for the Contents read + a
  `dbAck`-style breadcrumb so `scanDbStructure` refuses a stale `pristine:true` whose clear failed)
  is Ask-before fork-script surgery, and Workstream B item 4 already reopens these three provisioning
  scripts next session; risk is narrow (only a not-yet-scaffolded fork whose clear silently failed)
  — owner: operator — status: adjudicated(2026-07-02) scheduled into Workstream B item 4
- 2026-07-02 — [secure/maintainable] db-structure gate's pristine-template exemption keys
  only on `package.json.name === "fullstack-next-template"`, which only `/rebrand` rewrites —
  a fork created via `/new-project`/`/deploy` without `/rebrand` stays silently exempt from
  the ADR-031 domain-model check (`scripts/ship.mjs` `TEMPLATE_PKG_NAME`; senior-review
  2026-07-02, confidence 85) — WHY deferred: fix needs a coordinated stamp across all three
  fork-creation scripts (or a `project.config.json` pristine flag), too invasive at session
  end; checks (b)+(c) still run everywhere — owner: operator — status: fixed(34f1114)
  (replaced the package-name proxy with an explicit `"pristine": true` flag in
  project.config.json read by `scanDbStructure`; every fork-creation path clears it —
  rebrand.mjs, deploy.mjs, new-project.mjs)

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
