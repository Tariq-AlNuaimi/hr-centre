# ADR-005 — Deployment platform options: keep the droplet path; document the PaaS alternative

**Status:** Accepted
**Date:** 2026-05-21
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The template ships a DIY deployment stack: per-deploy DigitalOcean Droplet provisioning, Cloudflare DNS automation, GHCR private images, SSH-based stack deploys, Caddy + Let's Encrypt on the host, an encrypted off-host backup sidecar. ADR-001 locked this baseline; ADR-004 moved orchestration to GitHub Actions.

The first real operator (support-case fork) spent **multiple days** iterating to land a staging deploy. Each failure mode was real and well-isolated (TDZ in cloud-init render, GHCR package not auto-linked to source repo, SSH transport reset during `ufw --force enable`, slug rebrand drift, free-tier ruleset 403), but the **sum** of these touched eight integration boundaries — each a potential failure point on every iteration.

Phases 1–4b of the simplify-deployment work added: preflight validator, snapshot pre-bake, Phase B fail-loud, GHCR manifest probe, SSH transport retry, parallel secret writes, skip-ruleset-after-first. These moved the typical first-deploy time from "days" to "3–5 min" and the recurring deploy time to "60–90s via `action=redeploy`".

Phase 5b restructured `/deploy` so `redeploy` is the default action and `provision-and-deploy` is an explicit opt-in (with `force_reprovision` for advanced overrides). This effectively makes destructive provisioning a one-time setup; recurring deploys can never re-touch infrastructure by accident.

But the residual cost is still real:
- Eight integration boundaries to learn.
- ~14 secrets/variables in `/first-fork` for full prod (~7 for staging-only).
- Initial setup time even with snapshot: ~30–60 min, including running `/build-snapshot`, `/preflight`, then first `/deploy`.
- Failure modes that bit early operators are now caught early, but the operator must still understand them when reading logs.

For operators who **just want a Next.js app live with a custom domain**, this is overhead. The question is whether the template should migrate to a managed platform or document the alternative as a fork-time choice.

## Decision

**Keep the droplet-based architecture as the template's primary path.** It remains the right choice for projects that need:
- Self-hosted infrastructure (data residency, ops-portal-class internal tools).
- Deep customization of the reverse proxy (custom Caddy plugins, multi-domain stacks on one host).
- MinIO-specific S3 operations (object lifecycle, vendor-agnostic backups, future migration to other S3 stores).
- Encrypted off-host backups with operator-controlled keys (the age + rclone path).
- Predictable monthly cost (~$17/mo for a single-env stack: $12 droplet + $5 Spaces, $0 CF + $0 GHCR + $0 LE).

**Document DigitalOcean App Platform as the recommended alternative** for projects where:
- The above don't apply.
- Operator time is the primary constraint.
- Project is short-lived (a sprint, a demo) or low-traffic (UAT, internal dashboard).

Do **not** migrate `support-case` (or any existing droplet-based project) to a PaaS retroactively. The migration cost is real (~4–6 hours one-time per project: rework MinIO → Spaces calls, drop the Caddy + cloud-init stack, switch DB to DO Managed Postgres) and not justified for projects that are already running.

## Consequences

### Positive
- New operators have a documented "I just want it live in 5 minutes" path that doesn't require learning the template's eight integration boundaries.
- The template stays focused on its niche (self-hosted, customizable, predictable cost) without trying to be a PaaS replacement.
- Future template forks for "PaaS-class" projects can reference this ADR as the architectural rationale.

### Negative
- Two paths to document and maintain in `/first-fork` guidance.
- Operators new to both paths face a choice they may not have context to make.
- The template can't unify the two paths in a single `gh workflow run`; each platform has its own deploy mechanics.

### Mitigations
- Add a chooser to `/first-fork`'s preconditions: "Which path are you on?" with three-question flowchart (data residency? custom proxy needs? backup encryption?). Default route: droplet path for "yes to any" and DO App Platform for "no to all".
- Create a separate `fullstack-paas-template` repo if PaaS-style projects accumulate enough demand to justify a divergent baseline (Prisma-friendly Dockerfile, App-Platform-aware lib/storage.ts that talks to Spaces directly, no MinIO sidecar). Do not preemptively fork — wait for the second PaaS project to materialize.

## Alternatives considered

1. **Migrate the template to DO App Platform as the new default.** Rejected: existing operators have ops-portal-class projects that need self-hosted control. Forced migration of the support-case generation of projects would erase the encrypted backup story (App Platform doesn't expose host-level encrypted volume management) and complicate Caddy customization. Status-quo bias is correct here — the template's *current* baseline serves its current operators well.

2. **Build a "Phase 1 PaaS, Phase 2 lift-and-shift to droplet" template.** Rejected: doubles the cognitive load. Operators would have to learn both architectures + the migration cost between them. The migration itself is a separate skill from app development.

3. **Replace droplet provisioning with Coolify/Caprover on a long-lived shared host.** Rejected for the template baseline (would require operators to also manage Coolify upgrades, which is its own ops burden). Mentioned as a footnote for the rare operator running 5+ small projects.

4. **Vercel + Neon + Supabase Storage.** Rejected: lock-in to specific vendors; pricing curves get painful past free tier; the Next.js standalone Docker baseline (locked by ADR-001) wouldn't migrate cleanly. Mentioned as an option for very-small-scale projects in the "Quick comparison" below.

## Quick comparison

| Dimension | Droplet (template default) | DO App Platform | Vercel + Neon |
|---|---|---|---|
| Initial setup time | 30–60 min (one-time, with /first-fork + /preflight + /build-snapshot + first /deploy) | 10–15 min (connect repo, set env vars, deploy) | 5–10 min (connect repo, add Neon URL) |
| Recurring deploy time | 60–90s (action=redeploy or git push) | ~3–5 min (DO rebuilds Docker on every push) | ~2 min (Vercel build) |
| Monthly cost (single env, low traffic) | ~$17 (Droplet + Spaces) | ~$25 ($5 app + $15 managed Postgres + $5 Spaces) | $0–20 (free tier + Neon free + traffic) |
| Custom domain + LE cert | manual via CF + Caddy (auto) | auto (DO manages DNS + cert) | auto (Vercel manages) |
| SSH access to runtime | yes | no | no |
| Encrypted off-host backups | yes (age + rclone sidecar) | manual setup required | manual setup required |
| Failure modes operator must understand | ~8 (this template) | ~3 (build, DNS, env-var) | ~2 (build, env-var) |
| Time-to-debug when something breaks | high (deep stack visibility but lots of layers) | medium (DO build logs, no SSH) | low (Vercel logs + Neon dashboard) |

## Migration triggers

We'd revisit this decision and consider migrating the template's default if:

- **>50% of new forks fail to complete /first-fork within 1 hour.** Indicates the droplet path's setup is too brittle for the operator base. Today's data point: 1 operator, multi-day iteration (now resolved).
- **DigitalOcean App Platform adds: predictable encrypted backups + SSH escape hatch + multi-tenant Caddy customization.** Today these don't exist; if they appear, the droplet's last advantage shrinks.
- **MinIO becomes a maintenance burden** (security findings, deprecated APIs, performance issues at our scale). The template's S3-flavored storage layer (`lib/storage.ts`) can target either MinIO or DO Spaces with minor changes; if MinIO becomes painful, we shift the default and lose one of the droplet path's reasons-to-exist.

## Related

- ADR-001 — Template baseline (locks Next.js standalone Docker + Postgres + MinIO + Auth.js).
- ADR-002 — Observability stack (Sentry + Better Uptime, applies to either platform).
- ADR-003 — Release process (`/promote` / `/rollback`; today is droplet-path specific).
- ADR-004 — CI-driven ops (`gh workflow run` for every action; applies to either platform).
