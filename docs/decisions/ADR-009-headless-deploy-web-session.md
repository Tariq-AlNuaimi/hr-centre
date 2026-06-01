# ADR-009 — Headless deploy of an existing fork (`/deploy`) from a web session

**Status:** Accepted
**Date:** 2026-06-01
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-006 (Vercel + Neon rail), ADR-007 (solo-operator optimization). Does not supersede them.

## Context

Two on-ramps to a live URL already exist: `/new-project` (one-shot provisioner, but it is a
**GitHub Actions** workflow and is shelved while Actions billing is blocked — ADR-007) and
`/first-fork` (a **manual**, browser-driven click-through of Neon + Vercel). Neither fits the
common case that surfaced in practice: *an operator has already built (or `/conform`-ed) an app
inside a fork during a **Claude Code web session** and just wants it deployed* — without
GitHub Actions and without leaving the session to click through two dashboards.

The blocker discovered while trying to do this from a web session: **outbound network egress is
governed by the environment's network policy** (an allowlist proxy). Requests to
`api.vercel.com` / `console.neon.tech` return `403` with header `x-deny-reason: host_not_allowed`,
and arbitrary Neon DB hostnames do not resolve. This is **not** a credentials problem — an API
token cannot bypass the proxy. It is an environment-configuration decision made when the web
environment is created (see https://code.claude.com/docs/en/claude-code-on-the-web).

The provisioning logic itself was not the gap: `scripts/new-project.mjs` already calls the Neon
and Vercel APIs. What was missing was (a) a path that targets the **current, existing** repo
(skipping repo-create and the Cloudflare/apex-domain steps), and (b) a clear, early failure that
distinguishes "egress blocked" from "missing token".

## Decision

Add a **`/deploy`** skill backed by `scripts/deploy.mjs`:

- Provisions a Neon project, creates a Vercel project linked to the **existing** `<owner>/<slug>`
  GitHub repo with the five env vars, and triggers the first production deploy (using the
  `repoId` Vercel returns on the git link — no GitHub token needed).
- Runs a **preflight egress check** first. If `api.vercel.com` / `console.neon.tech` are blocked,
  it stops with the exact hosts to add to the environment's network policy, and states plainly
  that tokens cannot bypass the proxy.
- Reads `NEON_API_KEY` + `VERCEL_TOKEN` from the environment (never chat / never committed).
- Cloudflare / custom domains stay out of scope — `<slug>.vercel.app` is enough to share; the
  apex-domain CNAME flow remains in `/new-project`.

To use it from a Claude Code web session, the environment must be created with a network policy
allowing `api.vercel.com`, `console.neon.tech`, and (only if migrating/seeding from the session)
`*.neon.tech:5432`. Otherwise the identical command runs from any machine with the tokens set.

## Consequences

- **Positive:** an operator can go from a built fork to a live URL in one command, inside the
  web session, once egress is opened — no Actions, no manual dashboard clicking. The preflight
  turns an opaque mid-run failure into an actionable "allow these hosts" message.
- **Positive:** reuses the existing Neon/Vercel API logic and the `lib/log.mjs` helpers; no new
  runtime dependencies.
- **Negative / limits:** still gated on an environment-level network-policy change the operator
  controls — the template cannot grant egress. Seeding the admin still needs the Neon **direct**
  connection string (from a machine or a session with `*.neon.tech:5432` allowed).
- **Security floor unchanged:** tokens live in env vars only; the generated `AUTH_SECRET` and
  admin password are printed once for the operator to store, never committed.
