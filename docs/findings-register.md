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
- 2026-07-11 — [secure] ADR-041 P0 item (c) — **SAST-as-a-hard-CI-gate + `zizmor` action-pin
  audit are DEFERRED to CI activation, not landed in WS-2.** ADR-041 and the enterprise-P0
  blueprint (AC-4.3) list "promote `sast.yml` from dormant to a hard blocking gate" + add `zizmor`
  as P0. On the current free GitHub plan Actions billing is blocked, so every CI workflow —
  `sast.yml` included — is intentionally dormant (`on: workflow_dispatch` only; ADR-007/037): flipping
  the push/PR triggers now would fail-in-2s, not gate anything. So the *hard-gate* half is only
  meaningful once CI activates (at `/handoff` to a paid-Actions team, or when billing unblocks) — the
  same activation line ADR-037 already defines. **Interim control:** the Semgrep ruleset is mirrored
  locally by the `/audit` skill (runs on demand), and the trivy-pin + SHA-pin halves of ADR-041 P0
  DID land in WS-2a. `zizmor` is not yet wired. **Not silently dropped — recorded here for the
  operator to adjudicate**; the fix at activation is to restore `sast.yml`'s real triggers + add a
  `zizmor` workflow step. — owner: operator — status: open
- 2026-07-11 — [quality] WS-1 Docker image build is UNVERIFIED in-session — the enterprise self-host
  image (distroless Node 24 + `compose.prod.yaml` + Caddy) was authored to spec but there is **no
  Docker daemon in the build environment**, so it was not built/booted here. Per ADR-030 the image
  gate degrades to a WARN when no daemon is present and build-verification is delegated to CI
  (`docker-build.yml`) or a build-capable machine. Highest-risk unknown a build must confirm: the
  Prisma 7 client/query-engine resolves at runtime inside distroless `nodejs24-debian12` (glibc +
  libssl present, but confirm on a real boot). Base tags are patch-pinned; Renovate applies the
  `@sha256:` digest pin (ADR-041). — owner: operator — status: open
- 2026-07-03 — [maintainable] deferred-adoption #11 (specialist-agents) — **drop REVERSED by
  operator same day; now ADOPT.** The earlier drop reasoned that a stack-aware *review* seed would
  duplicate `senior-code-reviewer`. The operator redirected it: build it as a **build-time ADVISOR**
  (not a reviewer), which occupies a genuinely different slot (advice while building vs. review after
  push) and does not duplicate the review rail. Design + skill-vs-subagent mechanism analysis pinned
  in `docs/blueprints/deferred-11-specialist-stack-advisor.md`. **IMPLEMENTED session 15 (2026-07-03)**
  as the `/stack-advisor` skill (`.claude/skills/stack-advisor/SKILL.md`, wired into
  `.claude/skill-rules.json`) — one composed advisor, positive patterns only, explicit
  "I advise, I do not review" boundary; the optional thin subagent was not built (no offload need yet).
  — owner: operator — status: fixed(8d0aa61) (blueprinted → built → landing on main)
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
