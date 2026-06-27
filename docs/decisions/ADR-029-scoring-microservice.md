# ADR-029 — Deterministic scoring as a separate Python microservice

**Status:** Accepted
**Date:** 2026-06-27
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The Rihal Aptitude platform scores candidates on the Five-Factor model from a
120-item IPIP-NEO-120 questionnaire (ARCHITECTURE §6, §12.2). Scoring must be:

- **Deterministic** — the same answers always yield the same scores; an LLM never
  scores (the LLM is bounded to drafting role-profile prose and narrating numbers
  a human approves).
- **Defensible** — built on a published, public-domain instrument with documented
  norms, not a bespoke key we maintain.
- **Norm-referenced** — raw facet/domain sums plus percentiles against a community
  sample.

The canonical, maintained implementation of this exact instrument is the
`five-factor-e` Python library (NeuroQuestAi, MIT): it owns the reverse-key list,
the facet/domain bucketing, and Johnson's age/sex norm tables. The Next app runs
on Vercel (Node), where running a Python dependency in-process is not viable, and
transcribing the library's scoring keys into TypeScript would fork a safety-
critical table away from its upstream source.

## Decision

Run scoring as a **standalone Python FastAPI microservice** (`services/scoring`)
that wraps `five-factor-e`, and have the Next app call it over HTTP through a
single env var, **`SCORING_SERVICE_URL`** (optional Bearer via
`SCORING_SERVICE_TOKEN`). The service is stateless, holds no DB/PII/secrets, and
exposes `POST /score` (120 answers → raw + Johnson-normed percentiles per
domain/facet) and `GET /health`.

We **adopt, never transcribe** the library: the item bank's (domain, facet,
keyed) mapping is *generated* from the library's own algorithm + 55-item reverse
list (`services/scoring/scripts/gen_items.py` → `prisma/data/ipip-neo-120.ts`),
and percentiles come from the library's embedded Johnson norms. The Next seam
(`lib/scoring.ts` + `lib/validations/scoring.ts`) validates the request before
sending and the response after receiving (zod), with a bounded timeout.

The item bank itself is **global reference data** (no `orgId`), unlike every other
domain row: the instrument is a fixed, public-domain artifact shared by all
tenants; `text_ar` is editable in place.

## Consequences

### Positive
- No Vercel lock-in: the scorer runs anywhere (Cloud Run / Fly / Render / a
  container beside the DB); the Next app only needs a URL.
- Single source of truth for psychometrics — upstream fixes flow in via a version
  bump + regenerate, not a manual TS edit.
- Deterministic + unit-tested (golden snapshot) scoring, cleanly separable from
  the app's trust boundary; the scorer never touches candidate PII storage.

### Negative
- A second runtime (Python) and a second deployable to operate and monitor.
- A network hop on the scoring path (latency + a new failure mode).
- The norms are Johnson's self-selected web sample — relative, not census-
  representative (limits documented in `services/scoring/README.md`).

### Mitigations
- Bounded fetch timeout + zod response validation + `ScoringError` so a slow/bad
  scorer fails fast and visibly, never silently.
- Optional Bearer gate (constant-time) for defence in depth behind the private
  network; the Next `withInternalAuth` seam is the production front door.
- Norm limits are surfaced in the README and must be shown wherever a score is
  displayed (UI-SPEC F) — scores are structured input to a human decision, not an
  automated gate.

## Alternatives considered
1. **Transcribe the IPIP-NEO-120 keys + norms into TypeScript** — rejected: forks
   a safety-critical table from its maintained upstream; norm tables + the cubic
   percentile transform are large and error-prone to copy; "adopt, don't
   reinvent."
2. **Run Python inside Vercel (serverless function)** — rejected: mixed-runtime
   on Vercel is awkward, and it re-introduces the lock-in we want to avoid; the
   instrument's home is a portable container.
3. **Port `five-factor-e` to JS** — rejected: same fork risk as (1) plus ongoing
   maintenance of a re-implementation.
4. **Per-org copies of the item bank** — rejected for now: 120 rows × N orgs and
   re-translation per org, with no current multi-tenant divergence; a per-org
   override table is a future `/scale-up` if a tenant ever needs divergent wording.

## Migration triggers
- A second instrument (e.g. IPIP-NEO-300, or a cognitive battery) → generalize the
  service to select by instrument, keep the same seam.
- Need for an Oman/Gulf-specific normative sample → swap/extend the norm tables in
  the service; the API contract is unchanged.
- Scoring latency or availability becomes a problem → cache deterministic results
  keyed by (answers, sex, age), or co-locate the service with the DB.
- Multi-tenant translation divergence → introduce a per-org item-text override
  table (the item bank stays the canonical default).

## Related
- ARCHITECTURE §6 (scoring), §12.2 (item bank + scoring service phase)
- `services/scoring/README.md` — API, run instructions, Johnson norms provenance/limits
- `prisma/data/ipip-neo-120.ts` (generated) + `prisma/seed.ts`
- `lib/scoring.ts`, `lib/validations/scoring.ts`
- ADR-023 (Docker self-host rail) — the scorer ships a Dockerfile in that spirit
