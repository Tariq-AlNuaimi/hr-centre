---
name: handoff
description: Produces a clean handoff package for the IT team that owns production -- a HANDOFF.md with project state, env vars, schema, route inventory, and run-locally instructions. Use when the team has signed off and production ownership passes to IT.
---

# /handoff — Hand the approved project to the IT team

The prototype rail's exit ramp. The team has approved the project; now
package it so a different team (likely on a different repo, different
hosting, different ops model) can take ownership cleanly.

## Preconditions

- **Tier must be `shared`.** Read `project.config.json`. If `"tier"` is
  `personal`, **stop and refuse** with a friendly message:

  > "This is a `personal`-tier project — there's no IT team to hand it to, so
  > `/handoff` doesn't apply. If this is actually a company project, set
  > `\"tier\": \"shared\"` in `project.config.json` and run `/handoff` again."

  Do not generate `HANDOFF.md` for a `personal`-tier project.

- The project is feature-complete enough for the team to approve.
- The latest commit is on `main` and pushed.
- Vercel + Neon are still hooked up (so we can capture their state).

### Preflight: confirm the skill is in sync with the repo

Before generating anything, verify the files this skill references actually exist;
warn (don't crash) on each miss so the operator knows the handoff text may be stale:

- `docs/recipes/shared-security/4-atomic-audit-triggers.md` — the atomic-audit
  recipe offered above. If absent, say so and skip the offer.
- `docs/decisions/ADR-006-*.md` and `ADR-023` — referenced in the containerize
  section. Warn if `ADR-023` is missing (the section points at it).
- The re-containerize reference files (`docker-compose.dev.yml`, a shipped
  `Dockerfile`, the `pre-pivot` git tag). These are **not** guaranteed to be in a
  given fork; if any is missing, soften the containerize steps from "reference X"
  to "build X from scratch (it does not ship in this repo)" rather than pointing at
  a path that 404s for the IT team.

A clean preflight = proceed silently. A miss = one-line warning per item, then
continue with the affected sections adjusted.

### Shared-tier security checklist (before handling sensitive data)

A `shared`-tier fork that will hold Confidential / Restricted production data must
work through **`SECURITY.md` §16 — "Shared-tier security checklist (at `/handoff`)"**
before handoff: MFA (T-02), atomic audit (ADR-010), nonce-based CSP, account lockout
(Upstash), column encryption for any Restricted field, and SARIF / CodeQL active.
Each item is "done, or risk-accepted in writing by the project owner" (record
acceptances in `SECURITY.md` §11). Surface this list to the operator and reflect its
state in the generated `HANDOFF.md` "Security notes" / "Open issues" sections — do not
silently treat an unstarted checklist as cleared.

**Offer atomic audit before handing over regulated data (§16 item 2).** For a
`shared`-tier fork that will hold records the IT team must treat as tamper-evident /
provably complete (financial, compliance, anything regulated), **offer to apply
`docs/recipes/shared-security/4-atomic-audit-triggers.md`** as part of the handoff
prep. The shipped app-level audit (ADR-010) is non-atomic and has a bulk/upsert blind
spot; the Postgres-trigger recipe makes audit atomic (same transaction as the DML) and
complete across `updateMany` / `createMany` / `upsert` — the right state in which to
hand regulated data to a team that will be asked to _prove_ the audit trail. It's a
significant change with its own ADR, so propose it, don't auto-apply: if the operator
agrees, walk the recipe (then `/code-review` + `/ship`) before generating `HANDOFF.md`;
if they decline, record the risk-acceptance in `SECURITY.md` §11 and reflect "atomic
audit: not applied (risk-accepted)" in the `HANDOFF.md` "Open issues" section.

## What this produces

A single `HANDOFF.md` at the repo root, structured for the IT team to read
top-to-bottom without prior context. **Does not** modify any code. **Does
not** push or delete anything. The operator decides what to do with the
output.

## Steps

### 1. Snapshot the project

Read the current state of the repo and gather:

- **Repo**: name, current `main` SHA, current Vercel URL, current Neon
  project name.
- **Entities**: list every model in `prisma/schema.prisma` (skip Auth.js
  internal models: `Account`, `Session`, `VerificationToken`).
- **Routes**: list every `app/api/**/route.ts` with its HTTP methods +
  one-line purpose (from a header comment, JSDoc, or the file's actions).
- **Pages**: list every `app/[locale]/(dashboard)/**/page.tsx`.
- **Skills / scripts**: list anything under `scripts/` the operator used.
- **Env vars actually in use**: parse `lib/env.ts` for the zod schema.
- **Optional services wired**: check whether `lib/inngest.ts`,
  `lib/storage.ts`, or anything in `/scale-up`'s list got added.

### 1b. Feature-complete gate (ask before packaging)

A handoff that hides known defects isn't clean. Before writing `HANDOFF.md`:

- **Ask the operator directly:** "Any open bugs, half-finished features, or TODOs
  the IT team should inherit?" Capture their answer.
- **Pull GitHub issues** for the repo (`gh issue list --state open --json number,title,labels`
  or the GitHub MCP) and fold open issues into the **Open issues** section below.
- Grep the tree for `TODO` / `FIXME` markers and surface notable ones.

Fold all of this into the generated `HANDOFF.md` "Open issues / known TODOs"
section — an empty/clean result is fine, but it must be a deliberate "none open",
not an omission.

### 1c. Verify the Docker artifact builds (ADR-030)

Docker is a standard, mandatory build artifact — the "Running locally" section
below hands IT `make docker-up`, so that image must actually build. Run
`make docker-build` (or `npm run ship -- --full`, which gates it) and confirm it
succeeds before packaging. If the environment genuinely cannot build images,
that is a `"dockerAck"` in `project.config.json` + an adjudicated findings-register
line (never silent) — carry it into the `HANDOFF.md` "Open issues" section so IT
knows the artifact is unverified.

### 2. Write `HANDOFF.md`

Use this structure:

````markdown
# Handoff -- <Project Name>

> Generated by /handoff on <date>. Reviewed by <operator>.

## Status

- Production URL: <Vercel URL>
- Latest commit: <SHA> on `main`
- Approved by: <names from the team>

## What this app does

<2-3 sentences. Pull from the README or ADR-001's project description.>

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Postgres via Prisma 7
- Auth.js v5 (Credentials provider; <list any OAuth providers wired>)
- Tailwind v4 + shadcn/Radix (ADR-029) + next-intl (<list the locales actually enabled in
  `project.config.json`; the template default is English-only>)
- Vercel (hosting) + Neon (Postgres)
- <list any /scale-up additions actually wired: Inngest, Vercel Blob, Pusher, Sentry, Upstash>

### Known pre-release dependency — please read before go-live

`next-auth` is pinned at **`5.0.0-beta.32`** — a pre-release, in the authentication path.
This is deliberate and recorded in ADR-056 (the v5 beta is the only line supporting the App
Router patterns this template is built on), but the receiving team should make an informed
call rather than discover it during their own review:

- No stability guarantee across beta bumps; breaking changes can land in a patch.
- Security fixes ship on a pre-release cadence.
- Pin is exact (no `^`), so it will not move without a deliberate bump.

<Check whether v5 has since gone stable. If it has, say so and recommend the upgrade as the
first maintenance task; if not, note the pin and move on.>

<Also list any third-party Claude Code plugins the operator enabled locally. Since red-team R5
these live in the gitignored `.claude/settings.local.json`, so the handoff package does NOT
carry them by default — say so explicitly, and name any the team would need to re-enable.>

## Data model

<For each entity in prisma/schema.prisma:>

### <ModelName>

- Purpose: <1 line>
- Fields: <table with name, type, notes>
- Relations: <list>
- Indexes: <list>
- Soft-delete: yes/no
- Audit-logged: yes (every model except the EXCLUDE set is)

## API surface

<For each route, with HTTP methods + auth wrapper used:>

- `GET /api/<resource>` -- <purpose>. Wrapped with `withAuth`.
- ...

## Environment variables

<Render lib/env.ts's zod schema as a table: name | required? | purpose | example>

## Running locally

**Option A — Docker (the IT-team run path; recommended).** Docker is a standard
build artifact (ADR-030), so the whole app + Postgres stack comes up with one
command — no local Node/Postgres setup:

```sh
git clone <repo>
cd <repo>
cp .env.example .env
# Fill in AUTH_SECRET and the SEED_ADMIN_* vars (DATABASE_URL is wired to the
# bundled Postgres by the compose stack; override it to point at your own DB)
make docker-up       # builds the image + starts app + Postgres (docker-compose)
# App at http://localhost:3000 — migrations run on container start
```
````

`make docker-down` tears it down. The image holds no secrets (`.dockerignore`
excludes `.env`; they are injected at runtime). This is the exact artifact the
`/ship --full`, `/deploy`, and CI gates build and scan (trivy), so a green
handoff means this image already builds.

**Option B — native (dev loop):**

```sh
git clone <repo>
cd <repo>
cp .env.example .env
# Fill in DATABASE_URL (any local or hosted Postgres) and AUTH_SECRET
npm install
make db-up           # only if using the bundled docker-compose Postgres
npx prisma migrate dev
npx prisma db seed   # creates first admin user from SEED_ADMIN_* envs
npm run dev
# App at http://localhost:3000
```

## Deploying (current setup)

The project runs on Vercel + Neon. To take over:

1. Transfer the Vercel project to the IT team's Vercel team OR re-create from
   the repo. Settings → Transfer Project.
2. Transfer Neon project ownership OR snapshot the DB and restore into the
   IT team's chosen Postgres.
3. Re-set the env vars in the new Vercel project.
4. Point DNS to the new Vercel deployment.

### Moving OFF Vercel entirely (re-containerize)

**When:** the IT team's ops model is container-based (Kubernetes / ECS / Nomad /
Portainer) rather than serverless, or they need to self-host on their own infra.
Vercel + Neon is the prototype rail (ADR-006); a regulated/long-lived production
owner often re-containerizes. The app is plain Next.js + Postgres, so this is a
packaging change, not a rewrite.

**Use the `/docker` skill** — it wraps the steps below against the shipped rail.

**Steps:**

1. **The rail ships by default (ADR-023).** `Dockerfile`, `.dockerignore`, and
   `docker-compose.dev.yml` are in the repo, and `next.config.ts` emits
   `output: "standalone"` whenever `DOCKER_BUILD=1` (so the Vercel build is
   unchanged). You do NOT need to re-add these or hunt the `pre-pivot` tag —
   that guidance predated the rail.
2. **Build the image.** `make docker-build` (sets `DOCKER_BUILD=1`,
   multi-stage → slim runtime; runs `prisma migrate deploy` on start, mirroring
   `vercel.json`). Tag override: `make docker-build IMAGE=<registry>/<slug>:<tag>`.
   For a full local app+DB stack instead, `make docker-up`.
3. **Push to a registry** (GHCR / ECR / Artifact Registry):
   `docker push <registry>/<slug>:<tag>`. The image holds no secrets
   (`.dockerignore` excludes `.env`); secrets are injected at runtime.
4. **Deploy as a stateless service.** The image holds no state; provide
   `DATABASE_URL` (any Postgres host — Neon, RDS, self-managed) and the rest of
   the env vars from the "Environment variables" section above. Scale horizontally
   freely; the in-memory rate limiter becomes per-instance (swap to Upstash if
   that matters — `/scale-up`).
5. **Context:** see **ADR-006** Consequences / Mitigations (why the rail is
   serverless and what re-containerizing costs) and **ADR-023** for the
   containerization guidance, if present in `docs/decisions/`.

## Pre-handoff checklist

The `shared`-tier security layers (`SECURITY.md` §16), each marked
**Done** / **Risk-accepted** (with the §11 acceptance reference) / **Not done**:

| #   | Layer                                         | Status                                    |
| --- | --------------------------------------------- | ----------------------------------------- |
| 1   | MFA (T-02)                                    | <Done / Risk-accepted (§11 …) / Not done> |
| 2   | Atomic audit (ADR-010 / triggers)             | <Done / Risk-accepted (§11 …) / Not done> |
| 3   | Nonce-based CSP (T-05)                        | <Done / Risk-accepted (§11 …) / Not done> |
| 4   | Account lockout / cross-instance throttle     | <Done / Risk-accepted (§11 …) / Not done> |
| 5   | Column-level encryption for Restricted fields | <Done / Risk-accepted (§11 …) / Not done> |
| 6   | SARIF / CodeQL active + branch protection     | <Done / Risk-accepted (§11 …) / Not done> |

> Do not mark an unstarted item "Done". An unaddressed item is **Not done** unless
> the project owner accepted the risk in writing in `SECURITY.md` §11.

## Security notes (read before deploying)

See `SECURITY.md` for:

- Data classes (Restricted vs. internal).
- The findings list (T-01..T-09).
- Audit-log scrubbing invariants (`SCRUB_FIELDS`).
- Soft-delete semantics.
- API auth wrappers (`withAuth`, `withAdminAuth`, `withInternalAuth`).
- **§16 — the shared-tier security checklist** (MFA, atomic audit, nonce-CSP,
  account lockout, column encryption, SARIF/CodeQL). Complete or risk-accept each
  item before this app handles sensitive production data.

## ESLint rules

Ten local rules in `eslint-rules/` enforce the template's hard invariants.
They're configured at `error` -- do not relax without reviewing
`SECURITY.md` §12.

## CI / verification

- `verify.yml` runs typecheck + lint + contract tests + component tests + build (with `.next/cache`) + audit + scaffold smokes.
- `secrets-scan.yml` runs gitleaks on every push and uploads SARIF to the Security tab.
- `sast.yml` runs Semgrep with OWASP + secrets rulesets and uploads SARIF to the Security tab.
- `codeql.yml` runs CodeQL `javascript-typescript` analysis (manual dispatch + a weekly schedule); results land in the Security tab.

> **Reactivation step for the IT team:** these workflows ship with their `pull_request:` /
> `push:` triggers set to `workflow_dispatch`-only (they were dormant on the prototype's free
> plan; `codeql.yml` keeps a weekly `schedule`). On a paid plan, restore the commented
> `pull_request:` / `push:` triggers under `on:` in each file, confirm the `security-events:
write` permission stays so SARIF reaches the Security tab, and turn on branch protection on
> `main`.

## What was NOT done

- No load testing.
- No formal penetration test.
- No multi-tenancy — isolation is by deployment (one Vercel+Neon project per tool),
  a deliberate decision (ADR-011), not a gap. RLS / an `organizationId` model is only
  needed if a fork goes multi-org from a single deployment.
- <list anything the operator and team agreed was out of scope>

## Open issues / known TODOs

- **Audit-log retention** runs as a daily Vercel Cron (`vercel.json` →
  GET `/api/internal/audit-purge`, batched deletes; ADR-018). It is active iff
  the `CRON_SECRET` env var is set on the Vercel project (silent 200 no-op
  otherwise) — verify it is set and >=32 chars. Manual purges: POST with
  `x-internal-token: $AUDIT_PURGE_TOKEN`. (SECURITY.md §5, finding T-06 closed.)
- <list anything in GitHub Issues, the operator's notes, or ADR migration triggers>

## Contacts

- Original operator: <name + email>
- Approver(s): <names>
- IT team contact: <fill in>

````

### 3. (Optional, gated) Create a clean tarball

**Only build a tarball when the operator explicitly asks for one, or the target is
airgapped / cannot consume a GitHub fork.** The default handoff is the repo +
`HANDOFF.md`; a sealed artifact is the exception, not the norm — don't produce it
unprompted (it duplicates the repo and is one more place a stale secret can hide).

When asked / airgapped:

```sh
git archive --format=tar.gz --output=<slug>-handoff-$(date +%Y%m%d).tar.gz HEAD
````

This excludes `node_modules`, `.env`, `.vercel`, and any local artifacts.

### 4. Present to the user

Show the operator:

- The full path to `HANDOFF.md`.
- A short summary of what's in it.
- A reminder: **rotate any shared secrets** (AUTH_SECRET, AUTH_GOOGLE_SECRET,
  SMTP_PASSWORD, SENTRY_AUTH_TOKEN, etc.) before sending. The IT team will
  generate their own.
- The **audit-log-retention TODO** must appear in the generated `HANDOFF.md`
  (see the template's "Open issues" section) — retention is unscheduled and the
  IT team needs to wire Vercel Cron or a Neon policy if the project lives long-term.

## Do NOT in this skill

- Do **not** delete the Vercel project or Neon DB. The operator handles
  shutdown after the IT team confirms they've taken over.
- Do **not** push the `HANDOFF.md` automatically. Operator reviews first.
- Do **not** include `.env` contents in the tarball.
- Do **not** include any sentry / inngest / pusher API keys in the document.

## Verification

Before calling this done:

- [ ] `project.config.json` `"tier"` is `shared` — a `personal`-tier project stops
      at the refusal message and no `HANDOFF.md` is generated.
- [ ] The operator's answer on open bugs/TODOs, open GitHub issues, and any
      notable `TODO`/`FIXME` grep hits are folded into the "Open issues / known
      TODOs" section — a deliberate "none open" if there truly are none.
- [ ] `make docker-build` (or `npm run ship -- --full`) was run and succeeded, or
      its failure is recorded as a `"dockerAck"` in `project.config.json` plus an
      adjudicated `docs/findings-register.md` line.
- [ ] `HANDOFF.md` exists at the repo root with every section populated (Status,
      Stack, Data model, API surface, Environment variables, Running locally,
      Deploying, Pre-handoff checklist, Security notes, Open issues, Contacts).
- [ ] The `shared`-tier security checklist (`SECURITY.md` §16) is reflected item
      by item as Done / Risk-accepted (with the §11 reference) / Not done — no
      unstarted item marked Done.

**Emits:** a generated `HANDOFF.md` at the repo root (+ an optional sanitized
tarball when explicitly requested or the target is airgapped) — the operator
commits, reviews, and pushes it themselves; this skill never does so
automatically.
