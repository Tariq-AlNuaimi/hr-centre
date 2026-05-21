# ADR-006 — Pivot to Vercel + Neon; template is a prototype rail, not a production rail

**Status:** Accepted
**Date:** 2026-05-21
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Supersedes:** ADR-005 (PaaS-vs-droplet trade-off); partially supersedes ADR-001 (drops `output: "standalone"` Docker baseline and the GHCR / Portainer CI/CD line); partially supersedes ADR-003 (release/promote/rollback workflows replaced by Vercel native deploy + revert); partially supersedes ADR-004 (deploy/promote/rollback/restore/new-project workflows removed; verify/secrets-scan/sast retained).

## Context

ADR-001 locked a self-hosted Docker baseline (Next.js standalone + Postgres + MinIO + Portainer-managed Docker host + GHCR + Caddy). ADR-002 added Sentry + Better Uptime. ADR-003 specified release/promote/rollback workflows. ADR-004 moved orchestration to GitHub Actions. ADR-005 evaluated PaaS alternatives and rejected them, keeping the droplet path as the default.

After ADR-005 was accepted, the operator (who is also the template owner) clarified the actual use case:

- The **operator** is the only developer working in the repo. Iteration happens in Claude Code sessions.
- The **review audience** is non-developer Rihal stakeholders. They will not open PRs, install gh-cli, or learn GitHub. They will look at a URL and send back screenshots / sketches.
- The **production audience** is a **different team** at Rihal (the IT team), working in a **different repo** with their **own** deployment model. The prototype is a vehicle for getting alignment, not the artifact that ships to prod.

The droplet path was optimized for the wrong audience. Specifically:

- 8 integration boundaries (DO API, CF API, GH API, SSH, Caddy LE, GHCR, Docker, age + rclone) — none of which the non-dev reviewers ever see, all of which the operator must learn and debug.
- 14 secrets in `/first-fork`. The operator spent multiple days debugging cloud-init, GHCR visibility, SSH transport resets, and DO ruleset 403s — work that produced no value visible to the reviewing team.
- A "rollback" workflow that flips a Portainer stack image tag — but for prototypes, the reviewer never noticed the rollback existed; "git revert + push" would have been simpler and just as fast.
- Encrypted off-host backups (age + rclone) — a real production concern, but for prototypes that get scrapped or handed off in weeks, the cost (operator time + 14th secret) exceeded the benefit.

Meanwhile, the operator's actual workflow loop is:

1. Reviewer sends a screenshot or sketch.
2. Operator describes the change to Claude.
3. Claude edits code + commits + pushes.
4. New URL is live and shareable.
5. Loop until the team approves.
6. Handoff to IT team for their own production setup.

Every step in this loop except (3) is optimized when the deploy is invisible. Steps (4) and (5) are bottlenecked by deploy time and reliability.

## Decision

**The template is a prototype rail. The deployment platform is Vercel + Neon.**

Specifically:

1. **Vercel** hosts every fork. Push to `main` → production redeploys in ~90s. Push to any branch → preview URL appears at `<branch>-<hash>-<team>.vercel.app`. Rollback = `git revert` + push, or one-click "Promote previous deployment" in the Vercel UI. Custom domains optional.
2. **Neon** provides Postgres. Free tier (0.5 GB, no PITR) covers prototypes. Launch tier ($19/mo, 10 GB + PITR + multiple projects) covers projects that grow. The Prisma adapter (`@prisma/adapter-pg`) speaks Neon's standard Postgres protocol with zero code change.
3. **No Docker baseline.** `output: "standalone"` is dropped from `next.config.ts`. Vercel handles the build + runtime.
4. **No DigitalOcean.** No droplet provisioning, no Cloudflare DNS automation, no SSH-based stack deploys, no GHCR, no Portainer.
5. **No off-host encrypted backups.** Neon Launch's PITR + Neon's own backup story covers the prototype-class threat model. Restricted data (per `SECURITY.md` §1) that requires operator-managed encryption keys is out of scope for this template (such projects should NOT use this template — they belong on the IT team's stack from day 0).
6. **No MinIO sidecar.** File uploads are removed from the template baseline. When a prototype needs uploads, `/scale-up` adds Vercel Blob in ~10 lines of `lib/storage.ts`. Spaces / S3 / R2 remain options if Vercel Blob pricing or features don't fit.
7. **CI gates kept:** `verify.yml` (typecheck + lint + tests + build + audit + scaffold smokes), `secrets-scan.yml` (gitleaks), `sast.yml` (Semgrep). Branch protection becomes **optional** because the audience doesn't review PRs.
8. **Ops workflows deleted:** `deploy.yml`, `preflight.yml`, `promote.yml`, `rollback.yml`, `restore.yml`, `restore-test.yml`, `build-snapshot.yml`, `new-project.yml`, `release.yml`, `audit-retention.yml`, `bootstrap-secrets.yml`, `diagnose-host.yml`, `docker-build.yml`. Their corresponding scripts under `scripts/` and skills under `.claude/skills/` are also deleted. `audit-retention` is replaced by Vercel Cron (configured per-project in `vercel.json` via `/scale-up`).
9. **New skills added:** `/first-fork` (rewritten for Vercel + Neon), `/quickstart` (idea → live URL), `/scale-up` (growth recipes), `/handoff` (clean export for the IT team).

**The handoff is the production exit ramp.** When a prototype is approved, `/handoff` produces a `HANDOFF.md` with the project's state, schema, env-var list, route inventory, and instructions for the IT team to run locally and deploy on their own infrastructure. The IT team's setup is not this template's concern.

## Consequences

### Positive
- Operator goes from "I have an idea" to a shareable URL in ~10 minutes on first project, ~5 minutes on subsequent projects.
- Recurring deploy is `git push` (~90s). No `gh workflow run`, no Portainer webhook, no SSH transport retry logic.
- Zero infrastructure for the operator to manage. No droplet upgrades, no cert renewals, no Docker image lifecycle, no backup retention to audit.
- 14-secret `/first-fork` becomes 5-env-var `/first-fork`. The cognitive load matches the operator's actual job (build features, not run ops).
- Reviewer experience is unchanged: they still get a URL. They never knew the droplet existed.
- The template footprint drops by ~60% (12 GHA workflows + 9 scripts + `deploy/` directory + Dockerfile + docker-compose.prod.yml + 5 scripts/lib helpers + MinIO setup).
- New "starts simple, grows complex" path is real, not theoretical. Vercel + Neon both scale up with the same code; the `/scale-up` skill enumerates the additions without any platform migration.

### Negative
- **Vendor concentration.** Vercel + Neon are the deploy + DB providers. If either materially degrades (price, terms, outage profile), the operator's prototype rail is affected. Mitigations: (a) `lib/storage.ts` deliberately stays vendor-agnostic via `/scale-up` (Vercel Blob / S3 / Spaces / R2 are all interchangeable); (b) the Prisma + Postgres path means any Postgres-compatible host (Supabase / RDS / self-hosted) is a fallback; (c) the Next.js standalone output remains available — re-enabling it in `next.config.ts` makes the app containerizable in <10 lines.
- **No self-hosted option in the template anymore.** Forks needing on-prem must add a Dockerfile back. The `/handoff` skill explicitly documents how to re-containerize (point IT team at the pre-pivot tag in this repo for a reference Dockerfile).
- **Encrypted off-host backups go away.** Neon's own backups cover the prototype use case; for production data, the IT team owns it post-handoff. If a fork *does* hold Restricted-class data during the prototype phase, that's a misuse of this template — see SECURITY.md §1 for the policy.
- **Free-tier ceilings.** Vercel Hobby's 100 GB-hours/month and Neon Free's 0.5 GB will not cover every project forever. Operator should track Vercel + Neon dashboard usage and upgrade tier when a project gets real traffic.
- **Branch protection becomes optional.** Acceptable for the prototype phase because the operator is the only contributor. Once `/handoff` runs, the IT team enables their own protection in their fork / new repo.
- **ADR-005's "keep the droplet path" recommendation is now reversed.** Operators who already deployed via `/deploy` on the previous template version (e.g. the support-case fork) keep working — this ADR does not force a migration. New forks default to the new path.

### Mitigations
- The `/handoff` skill produces a clear artifact for the IT team. Their production-grade decisions (HA, encrypted backups, MFA, custom domain TLS, audit retention with offsite storage) are made on their own stack, with their own ADRs.
- The pre-pivot droplet machinery is preserved in git history under the `pre-pivot` tag (if applied) and in the prior version of this template before this commit. Operators with active droplet forks can continue to reference the prior `scripts/deploy.mjs` + cloud-init + Caddy setup as their own internal pattern.
- The `output: "standalone"` Docker baseline is documented in `/handoff` as "re-enable this line in next.config.ts to containerize." The escape hatch costs ~5 minutes of work.

## Alternatives considered

1. **Keep the droplet path, document Vercel as a side-option in `/first-fork`.** Rejected: ADR-005 already chose this; the past two weeks of operator debugging showed that "documented alternative" doesn't help when the default path has 8 integration boundaries. The operator stays in the default path's mental model. Making PaaS the default is the only change that actually shifts behaviour.

2. **DO App Platform + DO Managed Postgres.** A real candidate. Stays inside the operator's existing DO account. Rejected because (a) DO App Platform's build times are ~3-5 min on every push vs. Vercel's ~90s; (b) DO App Platform's preview-environment feature is less polished than Vercel's; (c) Vercel's Next.js-specific optimizations (image, ISR, edge) are valuable enough on their own; (d) cost difference (~$25/mo for DO App Platform + Managed Postgres vs. $0-19/mo for Vercel + Neon free/Launch) favors Vercel for the prototype-class use case.

3. **Cloudflare Pages + Cloudflare D1 / Hyperdrive + R2.** Cheaper at scale. Rejected because (a) D1 is SQLite — Prisma 7 + Postgres invariants would require porting; (b) Cloudflare Workers' Node compat for Auth.js + Prisma is improving but still has rough edges; (c) the prototype rail's "no migration when project grows" property requires Postgres parity. Worth revisiting in 12 months.

4. **Self-host Vercel-equivalent (e.g. Coolify or Caprover on a long-lived shared host).** Rejected: substitutes one ops burden (droplet lifecycle) for another (Coolify upgrades, multi-tenant config). The operator's time is the bottleneck, not infrastructure cost.

5. **Vercel + Supabase (instead of Neon) for DB + storage + auth.** Rejected because (a) the template already has Auth.js, swapping to Supabase Auth would touch every API route's session shape; (b) Supabase storage works fine but `/scale-up` can add Vercel Blob without changing auth; (c) Neon's branch-per-PR feature aligns with Vercel's preview-per-PR — meaningful for richer iteration loops later.

## Migration triggers (re-evaluate this ADR if)

- Vercel introduces material billing changes that move a typical prototype past $50/mo.
- Vercel's preview-per-PR feature degrades or is paywalled — preview URLs are the single highest-value feature for this audience.
- Neon's free tier shrinks below 100 MB or its connection pooling pricing changes materially.
- A prototype consistently graduates past the free tier ceilings (Vercel 100 GB-hours, Neon 0.5 GB) within its first 30 days. If this is common, the template should default to paid tiers and document the budgeting decision.
- A second class of fork emerges (e.g. customer-facing apps, not internal tools) that needs MFA + multi-region + encrypted backups from day zero. Such projects belong on a separate template; this one stays focused on internal-tool prototypes.
- The IT team requests that prototypes be authored on the same stack as production (whatever that turns out to be) to skip the `/handoff` translation step. Worth doing if it happens 3+ times.

## Related
- ADR-001 — Template baseline (partially superseded: `output: "standalone"` dropped, GHCR / Portainer CI/CD line dropped, MinIO baseline dropped).
- ADR-002 — Observability stack (unchanged; Sentry + optional uptime monitoring still apply; Better Uptime is optional via `/scale-up`).
- ADR-003 — Release process (partially superseded: promote/rollback/release workflows replaced by Vercel native deploy + revert).
- ADR-004 — CI-driven ops (partially superseded: deploy/promote/rollback/restore/new-project workflows removed; verify/secrets-scan/sast retained).
- ADR-005 — PaaS-vs-droplet trade-off (**fully superseded** by this ADR).
