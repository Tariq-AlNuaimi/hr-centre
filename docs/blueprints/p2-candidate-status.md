# P2 — Candidate status page (magic link)

Scope: lib/hiring/candidate-status.ts, lib/hiring/candidate-status-rules.ts, lib/hiring/careers.ts, lib/hiring/erasure.ts, app/[locale]/(careers)/careers/status/[token]/page.tsx, components/hiring/careers/**, messages/**, tests/contracts/p2-candidate-status.test.ts

Status: operator-approved P2 roadmap (2026-10-29), public path authorised. Source: UX audit
`tickets-hiring.md` P2-11. Benchmark: Greenhouse MyGreenhouse / candidate portal (candidate-facing
stage names, no internal detail); Workable / Lever application status links.

## Stories and acceptance criteria

- **US-1 (candidate) see where my application stands.** AC-1.1 `/careers/status/<token>` shows the
  role, company, applied date and five candidate-facing steps (Application received → Under review
  → Interviews → Final checks → Offer) with the current one explained. A drafted offer reads as
  "Final checks" until it is extended. AC-1.2 A rejection appears ("not progressing") only once the
  human rejection notice has been sent; before that the page stays at the step it stopped in and
  "last updated" does not move. Hired and withdrawn are stated. AC-1.3 No internal stage name,
  note, reason, score, interviewer or email address is read for the page.
- **US-2 (candidate) get the link.** AC-2.1 Applying through the careers board returns the link;
  the confirmation shows "Track your application". When SMTP and `AUTH_URL` are configured the
  confirmation email carries it too (core logged sender, ADR-095). Erasing the candidate revokes it.
- **Security.** AC-3.1 Under the already-public `/careers` surface (ADR-080); the token
  (ADR-090 magic link, purpose `hiring-candidate-status`, 180 days) is the only authorisation for
  one application; 30 views/min per IP; every failure the same "no longer valid" page;
  `noindex`, dynamic, never cached.

## Worst paths

- Unknown, expired, revoked token; erased candidate → the same invalid page.
- Requisition deleted → "Your application" with no role title.
- Email not configured → the link is shown on the confirmation only.

## Data

None new: `core_magic_links` rows (purpose `hiring-candidate-status`, subject = candidate id).
