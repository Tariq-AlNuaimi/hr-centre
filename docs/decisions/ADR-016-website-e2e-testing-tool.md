# ADR-016 — "Vibe Inspector": website E2E testing tool (extracted to its own repo)

> **SUPERSEDED — product extracted** to [`Tariq-AlNuaimi/vibe-inspector`](https://github.com/Tariq-AlNuaimi/vibe-inspector). Nothing in this repo implements it; the ADR is kept as the record of why it left.

**Status:** Superseded — product extracted to [`Tariq-AlNuaimi/vibe-inspector`](https://github.com/Tariq-AlNuaimi/vibe-inspector)
**Date:** 2026-06-10 (accepted) · 2026-06-12 (extracted)
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-001 (locked stack), ADR-008 (UAT via Playwright), ADR-013 (REST + zod boundary)

## Context

ADR-016 originally accepted building **Vibe Inspector** — point it at any website plus a
BRD, and Claude evaluates it across design fidelity, functionality, BRD coverage, and
security, producing a scored shareable report (Browserbase remote Chromium over raw CDP +
Claude analysis) — as a **first-class feature inside this template**. To keep its live
site from reverting it was merged into `main`, which polluted the template: every fork
generated from `main` would have been born carrying a whole product (37 files, 6
migrations, 4 deps, 3 Prisma models).

## Decision

The product **must live in its own repository**. It was extracted on 2026-06-12:

- **New home:** `Tariq-AlNuaimi/vibe-inspector` — full history preserved (template
  lineage + all product commits), `main @ f03ae59`, tag `v1.0.0_vibe`.
- **This repo:** commit `44088fe` removed the product files/migrations/deps and restored
  the 10 shared files it touched to their template versions. The full ADR text and
  implementation history remain in git history and in the product repo.
- This file stays as a tombstone so the ADR number is never reused and the trail to the
  product repo isn't lost.

## Consequences

### Positive

- Forks of the template are born lean again; the template stays a reusable starter.
- The product iterates freely in its own repo (own Vercel project, own ADRs from here on).

### Negative

- The template repo's original Vercel production URL no longer serves Vibe Inspector —
  the product repo needs its own `/deploy` (new Vercel project + Neon DB, then re-enter
  the AI-provider/Browserbase settings, which are env- and DB-stored).
- First session in the product repo should run `/rebrand` (it still carries the
  template's identity) and apply the open Semgrep finding there
  (`lib/secret-box.ts` — pin `authTagLength: 16` on the GCM decipher).
