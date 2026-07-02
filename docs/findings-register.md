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
