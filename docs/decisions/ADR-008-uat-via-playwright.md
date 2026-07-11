# ADR-008 — UAT through Chrome via Playwright (solo-dev acceptance loop)

**Status:** Accepted
**Date:** 2026-05-29
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Resolves:** the "UAT via Chrome" item deferred to _Future_ in ADR-007.

## Context

The template had no automated user acceptance testing. The only acceptance loop
was manual: the solo operator (a non-developer) clicks through the app before
sharing the URL with stakeholders, who then send back screenshots. ADR-007 listed
"UAT via Chrome (browser-driven acceptance testing)" as deferred future work
because it needs browser automation.

For a solo operator this is the highest-leverage testing gap: the repetitive
"does the app actually work end-to-end before I share it" check is exactly what a
browser robot should do. A market scan (2026) of agent-driven browser tooling:

- **Playwright (committed specs + CLI)** — the standard for _repeatable_ browser
  tests; runs Chromium headless/headed, screenshots, asserts flows; specs commit
  to the repo and travel across machines; CI-ready. One-time per-machine binary
  install. **Chosen as the backbone.**
- **Playwright MCP** — agent drives a live browser via the accessibility tree;
  great for _exploratory_ sessions but leaves no re-runnable artifact. Noted as an
  optional companion.
- **Chrome DevTools MCP** — Chrome-only, debugging/perf/Lighthouse focused,
  token-heavy; better for "why is this slow/erroring" than acceptance flows.
- **Claude in Chrome** — convenient day-to-day, not a repeatable artifact.

## Decision

Add a **`/uat` skill backed by Playwright (Chromium)**, with committed specs as
the backbone:

- `playwright.config.ts` resolves the target **URL-first with local fallback**:
  `UAT_BASE_URL` (a Vercel preview / prod URL, preferred) else `localhost:3000`
  with `npm run dev` auto-started.
- `tests/uat/`: `auth.setup.ts` (logs in once from env creds, saves the session),
  `smoke.uat.ts` (authenticated walkthrough of the shipped screens, screenshots
  attached as the shareable artifact), `guard.uat.ts` (unauthenticated users are
  bounced to login).
- npm scripts: `uat`, `uat:headed`, `uat:report`, `uat:install`.
- `@playwright/test` added as a **dev** dependency (not shipped to runtime).
- Credentials come from env only (`UAT_EMAIL`/`UAT_PASSWORD` or `SEED_ADMIN_*`).
- The `/uat` skill fits flows to each project's routes/entities and reports
  pass/fail with screenshots; it refuses to report green if the browser or
  credentials could not be set up.

VAPT-light (an OWASP ZAP baseline DAST against the running app) is a **separate,
follow-up** decision/skill (`/vapt`), kept distinct because UAT is functional and
VAPT is security, and ZAP carries a Docker dependency.

## Consequences

### Positive

- The solo operator gets a one-command "prove the app works end-to-end," and the
  screenshots are the stakeholder-review artifact in the same step.
- Specs are committed and machine-independent (consistent with the no-`.git/hooks`,
  multi-machine constraint); they can run in CI once Actions billing returns.
- Locale-independent selectors (`#email`, `getByRole`) work across `en` + `ar`.

### Negative

- Playwright needs a one-time per-machine browser install (`npm run uat:install`),
  like gitleaks/semgrep. Mitigated: the skill detects the missing binary and tells
  the operator, never silently passing.
- Local-target runs need a running DB + seeded admin; the URL target avoids this.
- `@playwright/test` is a large dev dependency (dev-only; excluded from
  `npm audit --omit=dev` and not in the runtime bundle).

### Mitigations

- `/uat` and the config surface missing-browser / missing-credential states loudly.
- `tests/uat/` ships starter flows; the skill regenerates them per project so they
  stay meaningful as entities are scaffolded.

## Alternatives considered

1. **Playwright MCP only (no committed specs)** — rejected as the backbone: no
   re-runnable artifact; good only for live exploration (kept as an optional companion).
2. **Chrome DevTools MCP** — rejected for UAT: debugging/perf oriented, Chrome-only,
   token-heavy. May return for performance profiling later.
3. **Cypress / Puppeteer** — rejected: Playwright is the agent-preferred, multi-browser,
   well-documented default with first-class screenshots/traces.
4. **Keep UAT manual** — rejected: it's the repetitive check most worth automating for a
   solo operator.

## Migration triggers

- **Actions billing restored / handoff:** add a `uat.yml` workflow (or extend `verify`)
  to run `/uat` against the Vercel preview on PRs.
- **Richer flows needed:** evolve `smoke.uat.ts` from "screen loads" to full CRUD
  journeys (create → edit → soft-delete → restore) per scaffolded entity.
- **Performance/debugging need:** consider Chrome DevTools MCP / Lighthouse.

## Future

- **`/vapt` (VAPT-light):** OWASP ZAP baseline DAST against the running deployment,
  layered on the existing static scans (`/audit`, `/ship`), with a clear caveat that
  it is not a substitute for a human penetration test.

## Related

- ADR-007 — deferred this item to Future (now resolved).
- `/uat` skill; `playwright.config.ts`; `tests/uat/`.
- `/audit`, `/ship` — code/dependency-level security scanning (distinct from UAT).
