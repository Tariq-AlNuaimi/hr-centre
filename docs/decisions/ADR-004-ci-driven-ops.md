# ADR-004 — CI-driven ops (Claude proposes, GitHub Actions executes)

> **SUPERSEDED by [ADR-006](ADR-006-pivot-to-vercel-neon.md)** — the GitHub-Actions ops surface (deploy/promote/rollback/restore/release against DigitalOcean, Cloudflare, Portainer, Better Uptime) was deleted; Vercel deploys natively. Historical record only.

- **Status:** Superseded by ADR-006
- **Date:** 2026-05-18
- **Supersedes:** none (extends the operational model implied by ADR-001 / ADR-002 / ADR-003)
- **Authors:** template maintainers

> **Superseded by ADR-006 (Vercel + Neon pivot).** This ADR moved the `/deploy`, `/promote`, `/rollback`, `/restore`, `/release` ops skills into GitHub Actions hitting DigitalOcean, Cloudflare, Portainer, and Better Uptime, with per-environment state in `.deploy-state.<env>.json`. ADR-006 deleted that entire ops surface — Vercel now owns deploys natively, so none of those skills or vendor integrations exist on the current rail. (The leftover `deployment-state` branch on the remote is a relic of this model; it is not used by the Vercel rail and must never be propagated into forks.) Kept for historical context only.

## Context

The template's six operational skills — `/deploy`, `/promote`, `/rollback`,
`/restore`, `/new-project`, `/release` — were originally implemented as Node
scripts under `scripts/` that Claude Code ran locally during a session. Each
script reaches out to DigitalOcean, Cloudflare, GitHub, Portainer, and Better
Uptime, and persists per-environment state to a gitignored
`.deploy-state.<env>.json` file on the operator's laptop.

This model has three problems:

1. **Claude Code's network sandbox blocks outbound HTTPS to vendor APIs.** The
   sandbox is intentional — it limits the blast radius of a prompt injection
   that asks Claude to exfiltrate secrets. Running ops scripts from a Claude
   session required loosening that sandbox, which weakens the security
   boundary across the entire harness.
2. **Tokens leak into the chat surface.** Even with a careful operator, raw
   `dop_v1_...` / `ghp_...` / Cloudflare tokens appeared in the conversation
   stream every time a script ran. Chat is a low-trust transcript surface —
   tokens that pass through it must be rotated.
3. **State lives on whoever ran the script last.** Lost laptop = lost record
   of which Droplet / Spaces bucket / Cloudflare record / Portainer stack
   belongs to which fork. Recovery means manually scraping the DO console.

GitHub Actions solves all three: unrestricted egress, secrets that never leave
the repo, an audit-logged run history, RBAC via Environments, and a state
file that we can commit to an orphan branch on the same repo.

## Decision

**All ops scripts execute via `workflow_dispatch` GitHub Actions workflows.**

- Claude's role narrows to: reason about plans, compose the exact
  `gh workflow run ...` command for the operator to paste, and (where MCP
  tooling allows) tail the run logs. Claude never touches a vendor API
  directly.
- Six workflow files live at `.github/workflows/{deploy,promote,rollback,
restore,new-project,release}.yml`. Two shared composite actions handle the
  state-branch round-trip:
  `.github/actions/{restore-state,persist-state}/action.yml`.
- The orphan `deployment-state` branch carries the
  `.deploy-state.<env>.json` files. The branch contains **only** resource IDs
  (Droplet, reserved IP, Cloudflare record, Portainer stack ID, GitHub repo
  metadata, Better Uptime monitor ID) — never credentials. Classified
  Internal (per SECURITY.md §1).
- As a backup source-of-truth, every DigitalOcean resource the deploy script
  creates is tagged with `vibe-managed=<slug>-<env>` and
  `vibe-resource=<droplet|reserved_ip|spaces_bucket>`. If the state branch is
  corrupted or wiped, `scripts/lib/state.mjs#discoverFromTags()` reconstructs
  a minimal state object from those tags.
- Per-environment GitHub Environments (`staging`, `prod`) scope per-env
  secrets and reviewer-protection rules. Repo-level secrets are reserved for
  shared tokens (`DO_API_TOKEN`, `CLOUDFLARE_API_TOKEN`,
  `BETTER_UPTIME_API_KEY`, `SSH_PRIVATE_KEY`, `BACKUP_AGE_IDENTITY`,
  `RCLONE_CONFIG`, `SENTRY_AUTH_TOKEN`, `GH_AUTOMATION_TOKEN`).
- Each workflow declares `concurrency: { group: <action>-<env>,
cancel-in-progress: false }` so two operators can't race a deploy on the
  same env.
- Scripts detect CI mode via `CI=true` / `NON_INTERACTIVE=true` env vars. In
  CI mode they never prompt; all confirmations require explicit `--yes` flags
  from the workflow caller. Credentials are read from env vars only — no
  `--token` flags are needed (workflows still set them, but the scripts pick
  them up from `process.env.*` first).
- The `/new-project` plan format is a JSON file committed to
  `plans/<YYYYMMDD-HHmmss>-<slug>.json`. Claude composes the plan, commits it
  via the GitHub MCP `push_files` tool (or instructs the operator to commit
  it), then triggers `new-project.yml` with the plan path as an input.

## Consequences

**Positive:**

- Operator never pastes a credential into Claude chat. Tokens live in GH
  secrets and are injected by Actions into the runner only.
- Workflows ship with the template; every fork inherits them on day one. No
  per-fork CI plumbing.
- Audit trail: every deploy / promote / rollback / restore is a GH Actions
  run with logs and an actor.
- RBAC via Environments: prod can require an approver. Branch protection
  gates which branches can dispatch.
- Recovery via DO tags closes the "lost state file" failure mode.
- Strengthens A02 (Cryptographic Failures) in the OWASP §10 table: tokens
  never traverse the chat surface.

**Negative:**

- Loses the "watch the deploy happen in chat" UX. Operator opens the Actions
  tab (or `gh run watch`) to see progress.
- `deployment-state` branch grows over time. Each deploy adds one commit.
  Needs occasional history pruning (e.g. `git checkout --orphan` reset every
  ~500 commits).
- A single global lock isn't enforced. Two workflows targeting **different**
  envs can commit to `deployment-state` concurrently — the
  `persist-state` composite action retries on push conflict, but pathological
  contention is theoretically possible. Per-env concurrency groups prevent
  the common race (two deploys to the same env).
- Forks that disable Actions (rare) lose this pipeline. They fall back to
  the local-execution model, which still works but requires loosening the
  Claude sandbox.

## Alternatives considered

- **Run scripts locally on the operator's laptop.** Works, but requires every
  operator to have all tokens locally; less auditable; locks state to one
  machine. Was the original model.
- **Self-hosted runner inside the deployed Droplet.** Chicken-and-egg for the
  first deploy. Also widens the blast radius of a Droplet compromise to
  "can dispatch arbitrary workflows".
- **Loosen Claude Code's sandbox.** Rejected on security grounds: the
  sandbox is what makes prompt-injection in vendor API responses a survivable
  event.
- **Seed-secrets helper workflow** (a `workflow_dispatch` that takes a JSON
  blob of secrets and calls `gh secret set` for each). Rejected: the
  `workflow_dispatch` input panel logs the masked inputs in the run UI. Risk
  of misuse outweighed convenience. Documented in `.claude/skills/first-fork/SKILL.md`
  is the direct `gh secret set` invocation instead.

## Migration triggers

Revisit this decision if:

- GitHub Actions minutes become a bottleneck (template forks share an
  org-level allocation; per-fork ops volume currently sits well under
  monthly free-tier limits).
- A per-org central runner makes sense (e.g. `rihal-ops/*` repos all share a
  hardened runner pool).
- A vendor adds fine-grained PATs that let us drop full-account scope tokens
  (DigitalOcean specifically).
- The `deployment-state` branch consistently shows merge conflicts despite
  per-env concurrency — would indicate the global-lock argument needs
  revisiting.

## References

- ADR-001 (template baseline) — sets the stack the workflows operate on.
- ADR-002 (observability) — Better Uptime + Sentry wiring referenced by
  `deploy.yml`.
- ADR-003 (release process) — `release.yml` is the CI host for that script.
- `SECURITY.md` §6 — secrets table updated to reflect "GH repo secret"
  storage for every operator-side token previously held in shell env.
- `.claude/skills/first-fork/SKILL.md` — operator onboarding now uses
  `gh secret set` / `gh variable set` instead of `--token` flags.
