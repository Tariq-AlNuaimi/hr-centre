---
globs: scripts/deploy.mjs, scripts/new-project.mjs, scripts/rebrand.mjs, scripts/migrate-from.mjs, lib/email.ts, lib/export.ts, vercel.json, next.config.ts, docker-compose*.yml, Dockerfile*, .github/**
title: Deploy & ops — Vercel/Neon, Docker, growth path
---

# Deploy & ops rules

Loaded when you touch deploy/build/ops files. Vercel + Neon is the default deploy path (ADR-006);
`git push` deploys (`main` → production, other branches → preview URL).

## Standing instructions (deploy)

- **After a green `/ship`, if the fork has no Vercel project, offer `/deploy`** (ADR-009; needs
  `NEON_API_KEY` + `VERCEL_TOKEN` + egress to `api.vercel.com`/`console.neon.tech` — see
  `.claude/skills/deploy/SKILL.md` for the full env table). If preflight reports blocked egress,
  surface the hosts; don't mistake it for a missing token.
- **A live URL is the default; verify access by RUNNING, not by assuming.** The operator wants a
  shared `*.vercel.app`/custom-domain URL, not a local-only setup. Never tell the operator "I
  don't have access" / "tokens aren't set" / pivot to `npm run dev` _before_ the relevant
  provisioner preflight has actually run and failed — the preflight
  (`scripts/deploy.mjs`/`new-project.mjs`) is the only authority, printing `Egress OK.` or the
  exact blocked hosts, and the env-check names any missing token. When it fails, report the
  _specific_ cause (blocked egress — not token-fixable — vs. a named missing token). Local dev is
  the fallback only when the operator asks for it or egress is genuinely blocked with no
  egress-capable machine available.

## Growth path

`/scale-up` has the recipe table (uploads → Vercel Blob, cron → Vercel Cron, jobs → Inngest,
realtime → Pusher, PITR → Neon Launch, flags → Edge Config, OAuth → Auth.js providers, errors →
Sentry, distributed rate limit → Upstash). None require restructuring.

## Known traps (don't "fix")

- Rate limiter is in-memory per-instance — fine until multi-instance; then Upstash via `/scale-up`.
- `sendEmail` returns `{ sent: false }` when `SMTP_HOST` unset — it does NOT throw.
- File uploads are not wired (ADR-006); PDF export is intentionally absent from `lib/export.ts`
  (pdfkit fragile in serverless).
- Docker is a **standard, mandatory build artifact** (ADR-030, supersedes ADR-023's opt-in
  stance): the image build is a gate at `/ship --full`, `/deploy`, `/handoff`, and CI (the fast
  `/ship` loop stays image-free). The `DOCKER_BUILD=1` gate in `next.config.ts` is **unchanged** —
  `output: "standalone"` is still emitted only under that env, so the Vercel build is
  byte-for-byte untouched; don't re-enable standalone unconditionally (it does nothing for
  Vercel). Escape hatch for an env that genuinely can't build images: `"dockerAck"` in
  `project.config.json` + an adjudicated ADR-030 line in `docs/findings-register.md`. Use
  `make docker-build` / `make docker-up`.

## Ask before (deploy surface)

Touching `lib/email.ts`, `lib/export.ts`; pushing to `main` directly when branch protection is on.
