# Blueprint — Hiring slice 6: the careers page and agency invite links

Part of `docs/blueprints/hiring.md` (the module contract; slice 6 ACs live there). This file
records what slice 6 builds and how it was verified. Both public surfaces were approved by the
operator for the Hiring port ("`/careers` (+apply API) and `/agency/[token]` with the same
controls"), including the route-decision and lint-allowlist entries.

Scope: app/[locale]/(careers)/**, app/[locale]/(dashboard)/hiring/**, app/api/careers/**, app/api/agency/**, app/api/hiring/agency-invites/**, app/api/hiring/settings/**, components/hiring/**, lib/hiring/**, lib/validations/hiring/**, i18n/route-decision.ts, eslint-rules/rules/no-bare-api-route.mjs, app/tokens.css, app/globals.css, tests/contracts/hive-public-surface.test.ts

## Stories

- As a candidate, I browse Rihal's open roles on `/careers` (search and team chips), open one and
  apply with my contact details after accepting the privacy and AI-use notice.
- As HR, I post a requisition to the careers page from its posting console; it appears on the
  board only once it is OPEN with a signed JD, and leaves it when either stops being true.
- As HR, I create an agency invite link — for one requisition, or a general talent-pool link —
  with an expiry and a submission limit, copy it once, and revoke it.
- As an agency, I open my link and submit a candidate with their CV (PDF), salary expectation and
  why they fit, confirming the candidate consented.
- As a hiring admin, I cap how many careers applications one role takes per day.

## Scenarios

Happy: a requisition is posted to the careers page → it is listed within a minute (cached 60 s,
revalidated on posting / JD changes) → a candidate applies → they land as a NEW application from
the careers page, consent time and notice version recorded → an agency submits two candidates
through a 2-submission link → the third attempt is refused.

Worst:

- The consent box is not ticked (or the request is forged without it) → 400; nothing is stored (D2:
  Interview Hub stamped consent unconditionally).
- The same person applies twice with different capitalisation → 409 (D18: Interview Hub compared
  case-sensitively).
- The role was closed after the page loaded → 404 "no longer open"; the board never shows pay.
- A burst of applications → 5 per minute per IP; the per-role daily cap answers 429.
- An agency link is guessed, expired, revoked, or for a role that is no longer postable → the same
  "not valid" page and the same 404 — no oracle. Its token is 256 random bits and only its hash is
  stored; the raw link is shown once.
- Two agency submissions race for the last slot → the create and the recount share a Serializable
  transaction; the loser gets 429 or "try again".
- An agency uploads a file named `.pdf` that is not a PDF → refused by its bytes.
- File storage isn't configured → agency submissions answer 503 with a sentence; the careers
  board and apply (no file) keep working.
- A visitor's browser or HR account prefers dark mode → the candidate-facing pages stay light.

## Architecture

- Public pages live in `app/[locale]/(careers)/` with their own chrome (no console sidebar or user
  menu); `/careers` and `/agency` are `CANDIDATE_PATHS` in `i18n/route-decision.ts`.
- Public APIs: `GET /api/careers`, `POST /api/careers/apply` (exact `PUBLIC_API_PATHS`) and
  `POST /api/agency/[token]/submit` (a pinned `PUBLIC_API_PATTERNS` regex); each is an exact file
  in `no-bare-api-route`'s allowlist, rate-limited per IP (and per token for the agency link),
  `no-store` + `noindex` on writes.
- `lib/hiring/careers.ts` (cached board, apply), `lib/hiring/agency-invites.ts` (token, pure gate,
  resolve, public submit, admin list / create / revoke).
- HR's side: `/hiring/sourcing` (agency invites + the careers daily cap).
- The candidate brand is the `--careers-*` tokens and the `.careers-light` scope (tokens.css /
  globals.css).

## Changes from Interview Hub

- D2 and D18 fixed (above). The agency name always comes from the invite.
- The careers page view counter is not ported (Interview Hub had already removed it).
- "Don't see your role?" no longer opens the first role's application form (it credited an
  application to a role the visitor never chose); it says new roles appear here first.
- Agency invites are managed by HR under Sourcing (Interview Hub's page sat under admin-only
  Settings while its API was open to editors).
- General invites are scoped to the creator's company, so a company-scoped HR user sees only
  their own.

## Open questions

- Production needs `BLOB_READ_WRITE_TOKEN` for agency CVs (and all hiring files); until it is
  set, agency submissions answer 503 and say so.
