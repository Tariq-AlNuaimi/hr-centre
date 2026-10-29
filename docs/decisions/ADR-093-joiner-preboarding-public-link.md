# ADR-093 — Joiner preboarding through a public magic link

**Status:** Accepted — operator-approved P2 roadmap (2026-10-29; "new public path authorised")
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

A joiner is a `PRE_JOINER` with no login. HR collected their introduction, hobbies and picture by
email and typed them in (starter tasks T08/T09), and chased documents by hand. BambooHR's New Hire
Packet, HiBob and Rippling all let the joiner fill this in before day one, with reminders.

## Decision drivers

- No account for someone who has not started; SSO arrives later and only for employees.
- One security primitive for public links (ADR-090), not a fifth copy.
- ADR-078 data minimisation: no ID numbers and no ID document files in JML.
- Honest when file storage (Blob) is not configured.

## Considered options

### Option 1 — public page + two public API routes on an ADR-090 magic link (chosen)

`/preboarding/<token>` (page), `POST /api/preboarding/<token>` (form) and
`POST /api/preboarding/<token>/photo` (picture). The token (purpose `jml-preboarding`, subject =
the JOIN case) is the only authorisation and opens one case, only while it is an open onboarding
of someone still `PRE_JOINER`. Hashed, expiring at the end of the planned start day (3–60 days),
revocable by HR; per-IP and per-token rate limits; one 404 for every failure; `noindex`,
`no-store`.

- Good, because it reuses the audited link service and the public-route allowlist pattern.
- Bad, because it is one more unauthenticated entry point (mitigated as above).

### Option 2 — an external forms tool (Microsoft Forms, Typeform)

- Bad, because answers would still be copied in by hand, and personal data leaves the system.

### Option 3 — create a login for the joiner

- Bad, because it creates an account (and a credential) for someone who may never start, before
  SSO exists.

## Decision

Option 1. The form completes T09 (introduction/hobbies) and, with a picture, T08. The documents
checklist records only what the joiner says (sent / will bring / does not apply) as a note on
T04–T07; it never completes a "Receive …" task — HR does when the document arrives. The picture is
stored privately in Blob; without Blob the upload shows a disabled state and asks the joiner to
bring one. Reminders at 10/5/2 working days before the start (core calendar): a bell to the HR
owner, and a fresh link by email when SMTP is configured (raw tokens are never stored, so a
reminder cannot repeat an old link). Anonymisation of the joiner case deletes the row and the
picture.

## Consequences

- `i18n/route-decision.ts` (`JOINER_PATHS`, two `PUBLIC_API_PATTERNS`) and the
  `no-bare-api-route` allowlist list the three surfaces exactly.
- A template whose T08/T09 codes were renumbered simply does not get them auto-completed.
