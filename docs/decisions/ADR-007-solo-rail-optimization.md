# ADR-007 — Optimize for solo operator on free plan; template-as-standard with conformance + tiers

**Status:** Accepted
**Date:** 2026-05-29
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-006 (Vercel + Neon prototype rail). Does not supersede it.

## Context

ADR-006 pivoted the template to a Vercel + Neon prototype rail and deleted the self-hosted
machinery (Droplet, Portainer, GHCR, Caddy, MinIO, age/rclone backups, and most ops
workflows). After that pivot, several realities about how the template is actually operated
came into focus:

- **The operator is a non-developer ("vibe coder").** They describe intent in plain language
  and rely on Claude Code to implement it correctly and safely. They cannot reliably eyeball
  code for bugs or security flaws, so the committed guardrails (ESLint rules, auth wrappers,
  audit extension, contract tests) are the real safety net — not human review.
- **Solo operator on a free GitHub plan; Actions billing is blocked.** The CI workflows
  (`verify.yml`, `secrets-scan.yml`, `sast.yml`) do **not** run, and branch protection cannot
  be enforced. Security enforcement therefore must live locally and in-repo, not in CI.
- **Multi-machine (two laptops, a phone, Chrome).** Nothing may depend on a single machine,
  which rules out `.git/hooks`. Enforcement must be committed files that travel with the repo,
  plus documented rules in `CLAUDE.md` that Claude Code follows on any machine.
- **The template is a STANDARD, not just a starter.** Three workflows use it: (1) start a new
  project; (2) bring **foreign code** up to the standard and push it to a new repo; (3) run
  **personal** projects as well as **shared** company ones.
- **`SECURITY.md` had drifted.** It still described ~51 references to infrastructure deleted in
  ADR-006 and listed 9 CI workflows when only 4 exist — including a false claim that audit-log
  retention ran monthly via a workflow that no longer exists.

The existing skills harness, the four `rihal-template/*` ESLint rules, the Prisma audit
extension + `SCRUB_FIELDS`, the contract tests, and the locked stack are all strong and were
kept unchanged. The optimization targeted the gaps around them, not the core.

## Decision

Optimize the template for a solo, non-developer operator on a free plan, and formalize it as a
reusable standard:

1. **Re-home enforcement from CI into local `/ship`.** `/ship` now runs typecheck → lint →
   tests → build → **gitleaks** → **npm audit**, stops on first failure, and refuses to
   silently skip a scan when the tool is missing. It is the active gate, machine-independent,
   and replaces branch protection for a solo operator. The CI workflow files stay in the repo,
   labeled dormant, and re-activate at `/handoff` when the IT team's paid plan runs Actions.
2. **Reconcile `SECURITY.md` to the Vercel + Neon reality.** Remove dead-infra references; list
   only the 4 real workflows; reframe secrets around Vercel env vars; mark backups as Neon's
   responsibility; cut the findings-SLA table (no team to promise to) while keeping the
   T-01…T-09 register and the CVE/suppression ledgers.
3. **Fix the audit-retention gap (DROP).** Nothing schedules `app/api/internal/audit-purge`.
   Keep the endpoint as a documented dormant route; flag retention as the IT team's
   responsibility at `/handoff` (Vercel Cron or a Neon policy).
4. **Add Superpowers** for the requirements/planning front-end (brainstorm → spec → plan →
   TDD build), with a standing market-benchmarking pass. Boundary: Superpowers for real
   multi-file features that deserve a spec; `/quickstart` for throwaway idea-to-URL. (Install
   and the throwaway test run are operator-driven — `/plugin` is interactive.)
5. **Adopt native `/code-review`** for pre-push review of security-sensitive diffs (auth,
   schemas, API routes, `lib/`), replacing the CI review gate.
6. **Add `/audit`** — an on-demand local security scan (gitleaks + npm audit + Semgrep) against
   any target path, runnable manually before sharing and used as the first step of `/conform`.
7. **Add `/conform`** — bring foreign code up to the standard: security-scan first, report gaps
   against the hard-rules, fix only what the operator approves (**never silent auto-fix**), then
   push to a fresh fork. On the current plan it uses `/first-fork`, not `/new-project`.
8. **Add a `personal` / `shared` tier switch** (`project.config.json`, default `personal`, set
   during `/first-fork`). The **security floor is identical for both** (auth wrappers, no leaked
   secrets, zod at the boundary, no raw SQL, the four ESLint rules, audit log ON, `/ship` before
   push). `shared` adds `/handoff`, the compliance section, CI activation, and the formal
   findings register; `personal` skips them. `/handoff` refuses to run on a `personal` project.

## Consequences

### Positive
- Security is enforced where the operator actually works (local `/ship` / `/audit`), on every
  machine, with no CI and no `.git/hooks`.
- `SECURITY.md` is trustworthy again — it describes the system that actually ships.
- The template now has a clear on-ramp for foreign code (`/conform`) and a clean way to scale
  ceremony to the project's nature (tiers) without ever lowering the security floor.
- A structured requirements/planning front-end (Superpowers) fills the lifecycle gap before
  `/quickstart`'s fast build.

### Negative
- Enforcement depends on the operator (and Claude Code) actually running `/ship` / `/audit` /
  `/code-review` — there is no server-side gate until handoff.
- `gitleaks` and `semgrep` are not always installed; the skills must (and do) report that loudly
  rather than pass silently, which adds a setup step on a fresh machine.
- The CI workflows sit dormant and could rot; they are labeled and revisited at handoff.

### Mitigations
- Hard rules in `CLAUDE.md` ("Run `/ship` before every push"; "run `/code-review` before
  security-sensitive pushes") make the local gate the documented default Claude Code follows.
- `/ship` and `/audit` print exact install instructions when a scanner is missing and never mark
  a target clean if a scan could not run.
- CI re-activates at `/handoff`, where a paid plan and branch protection take over.

## Alternatives considered
1. **Keep enforcement in CI only** — rejected: CI cannot run on the free plan, so the gate would
   be absent during the entire prototype phase, which is exactly when the non-dev operator needs it.
2. **`.git/hooks` for local enforcement** — rejected: not machine-independent; hooks don't travel
   with the repo across two laptops + a phone.
3. **Silent auto-conform of foreign code** — rejected: foreign code doesn't know the template's
   invariants; silent edits could mask or introduce security gaps. `/conform` is report-and-approve.
4. **Adopt `next-supabase-starter` / switch to Supabase** — rejected: this rail (Neon + Prisma) is
   more mature and was chosen deliberately in ADR-006.
5. **Add the Karpathy plugin / BMAD / a heavy multi-agent framework** — rejected: their useful
   principles already live in the hard-rules and "known traps"; the weight isn't justified.

## Migration triggers
- **GitHub Actions billing restored / IT handoff:** re-activate the dormant CI workflows by
  restoring their real triggers (uncomment the `pull_request:` / `push:` lines under `on:` in
  `verify.yml`, `secrets-scan.yml`, `sast.yml` — they are set to `workflow_dispatch`-only so they
  don't auto-run and fail-in-2s on the free plan) and turn on branch protection.
- **`/new-project` needed:** it is itself a GitHub Actions workflow and cannot run while billing is
  blocked — use `/first-fork` (manual) as the on-ramp until then. Its Cloudflare DNS step is
  **still wired** post-ADR-006 (`new-project.yml` uses `CLOUDFLARE_API_TOKEN` + `NEON_API_KEY` +
  `VERCEL_TOKEN`); no DO/SSH/GHCR/Portainer remain.
- **A `shared`-tier project ships:** wire audit-log retention (Vercel Cron or Neon policy) — it is
  unscheduled by default (finding T-06).
- **Horizontal scale on Vercel:** swap the in-memory rate limiter for Upstash (per `/scale-up`).

## Future
- **UAT via Chrome (browser-driven acceptance testing):** deferred — needs browser automation.
  A later phase can wire a headless-browser review loop so the operator's screenshot/sketch
  feedback can be checked against the live preview automatically.

## Related
- ADR-006 — Pivot to Vercel + Neon (the rail this optimizes).
- ADR-001 — Template baseline (locked stack + invariants, kept).
- ADR-002 — Observability stack (Sentry).
- `SECURITY.md` §14 (CI gates), §5/§11 (retention), §6 (secrets), §9 (compliance/tiers).
- `/ship`, `/audit`, `/conform`, `/handoff`, `/first-fork` skills; `project.config.json`.
