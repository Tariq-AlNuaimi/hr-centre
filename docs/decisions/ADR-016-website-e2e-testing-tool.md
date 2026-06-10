# ADR-016 — "Vibe Inspector": an in-app website E2E testing tool (Browserbase + Claude)

**Status:** Accepted
**Date:** 2026-06-10
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-008 (UAT via Playwright — the operator-driven analogue), ADR-001 (locked stack), ADR-013 (REST + zod boundary)

## Context

The operator wants a **product** built on this template: point it at *any* website, give it a
BRD / scope-of-work, and have Claude evaluate the site end-to-end across **design fidelity,
functionality + logic, BRD coverage (QA), and security + benchmark**, producing a scored report
that non-developer stakeholders can read and share via the usual `<slug>.vercel.app` URL.

This overlaps conceptually with the existing `/uat`, `/design-qa`, `/qa`, and `/audit` **skills** —
but those are *operator-driven Claude Code skills* that run in a terminal session against apps the
template produces (with a foreign-app DOM-crawl fallback). They are not something a stakeholder can
self-serve. The ask here is a hosted app with a UI, run history, and persisted reports.

Market scan (June 2026): the dominant AI-testing pattern is **Claude Code + Playwright MCP / Agent
Browser** (dev-facing, drives a browser without hardcoded selectors) and managed E2E suites like
**QA Wolf**. Most tools *generate or maintain test scripts*; few *judge a live site against a
business spec* across multiple dimensions and return a scored, evidence-backed report. That gap is
what this tool fills.

The hard constraint: **Vercel serverless cannot run a full headless browser cheaply.** Bundling
Chromium is heavy and fragile in the Lambda runtime.

## Decision

Build **Vibe Inspector** as a first-class feature in the template (not a skill), with:

1. **Browser engine — Browserbase (hosted Chromium) over CDP.** A Browserbase session is created
   via its REST API; we connect with `playwright-core`'s `chromium.connectOverCDP(connectUrl)` and
   drive the *remote* browser. No Chromium binary ships in the bundle, no `playwright install` step.
   Gated by `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` — when unset, a run fails with a clear
   "configure the engine" message (same graceful-degradation pattern as `lib/email.ts` + `SMTP_HOST`).

2. **Analysis — the Anthropic SDK (`@anthropic-ai/sdk`), model `claude-opus-4-8`.** Per-dimension
   analysis uses vision (the captured screenshot as a base64 image block) + the captured DOM/links/
   headers + the BRD, with **structured outputs** (`messages.parse()` + a zod schema) so every
   dimension returns a typed `{ score, status, findings[] }`. Model is overridable via
   `ANTHROPIC_MODEL`. Gated by `ANTHROPIC_API_KEY`.

3. **Execution model — synchronous run with `maxDuration`.** `POST /api/assessments/[id]/runs`
   creates a `TestRun` (PENDING), executes the capture + analysis inline (status → RUNNING →
   COMPLETED/FAILED), and returns the finished run. The UI shows a progress state while the POST is
   in flight, then renders the report; `GET /api/runs/[id]` re-reads it. This avoids the
   "background work killed after response" trap on Vercel. **Limitation:** a run must fit inside the
   function's `maxDuration` (60s on Hobby, up to 300s on Pro). For heavier multi-page crawls, the
   `/scale-up` path is **Inngest** (durable background jobs) — out of scope for the MVP.

4. **Dimensions (MVP).** `DESIGN`, `FUNCTIONALITY`, `BRD_COVERAGE`, `SECURITY`, `BENCHMARK`.
   Security is a **lightweight** pass (TLS, response headers, exposed-info heuristics + Claude
   analysis) — explicitly **not** a pentest (that remains the future `/vapt`). Benchmark compares
   against peer products from the model's knowledge and is flagged as a judgment call.

5. **Data model.** `Assessment` is the user-facing, CRUD-able entity (soft-delete + audit + RBAC,
   per the template invariants; registered in `lib/prisma/soft-delete-extension.ts` +
   `lib/prisma/recyclable.ts`). The run artifacts — `TestRun` → `DimensionResult` → `Finding`, plus
   `RequirementCoverage` — are machine-generated output. They are **left in the audit set** (not
   excluded): a run produces a bounded number of rows, audit is cheap, and keeping them in preserves
   the "audit is automatic" invariant without an EXCLUDE-set edit. They hard-delete by cascade when
   their parent `Assessment` is permanently removed from the recycling bin.

## Consequences

- **Two new runtime deps** (`@anthropic-ai/sdk`, `playwright-core`). Both are core to the feature;
  recorded here per the CLAUDE.md "ask before installing a dep > 50 KB" rule. `playwright-core`
  carries no browser binaries (remote-only), keeping the bundle reasonable.
- **New public-ish surface** `/api/assessments/*` + `/api/runs/*`, all wrapped with the auth helpers
  (`withAuth` for reads, `withEditorAuth` for writes) and rate-limited on writes/run-trigger.
- **External calls leave the process** to Browserbase + the Anthropic API. The target URL + BRD text
  are sent to both. This is acceptable for an internal prototype; documented so a `/handoff` review
  can re-evaluate for any Restricted-data use.
- The tool is **honest about "could not run"**: missing keys or a failed browser launch yield a
  FAILED run with a reason, never a green report.
- Security + benchmark dimensions are **advisory**, not authoritative — the report labels them so.

## Alternatives considered

- **Extend the `/uat` skill to take any URL + BRD.** Faster, reuses the harness, no infra — but it's
  operator-driven, not a stakeholder-facing product. Rejected for this ask (kept as the complementary
  developer tool).
- **Claude computer-use driving a sandboxed browser.** Most agentic, but slowest/most expensive and
  still needs a hosted browser. Deferred.
- **Playwright in a self-hosted worker.** Full control, but adds an always-on service to operate —
  against the prototype-rail grain (ADR-006). Browserbase keeps ops near zero.
- **Bundle Chromium in the Vercel function (`@sparticuz/chromium`).** Fragile, large, cold-start
  heavy. Rejected.
