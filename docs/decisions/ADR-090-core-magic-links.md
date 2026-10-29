# ADR-090 — One magic-link service for every public link

**Status:** Accepted — operator-approved P2 platform roadmap (item 5)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

Two modules implemented the same bearer-link pattern: HR tickets
(`EscalationReplyToken`, ADR-070's seven-clause token contract) and Hiring
(`HiringAgencyInvite`). Preboarding and a candidate status page are about to add
two more. Every copy is a chance to drop a clause (expiry checked only by a
cleanup job, a failure that tells "expired" from "unknown", a raw token column).

## Decision drivers

- One audited security primitive; new public links must not re-derive it.
- Existing links in mailboxes must keep working across the change.
- Module records that carry domain data (an agency's cap) stay module-owned.

## Considered options

### Option 1 — core `MagicLink` table + `lib/core/tokens/magic-link.ts` (chosen)

A `purpose`-namespaced table holding digest, subject id, expiry, revocation and last use,
and a service with issue / resolve / revoke. Reply links move onto it (rows copied);
agency invites use its mint/digest/shape primitives over their own row.

- Good, because new links (preboarding, candidate status) are three calls.
- Good, because purpose isolation is enforced in one place.
- Bad, because `subject_id` is a soft link (no FK cascade); a closed subject's links
  must be revoked explicitly, as ADR-070 already requires.

### Option 2 — shared helper functions only, every module keeps its own table

- Good, because no migration.
- Bad, because every new public link still needs a table, a migration and its own
  copy of the read-time checks.

### Option 3 — signed stateless tokens (JWT / HMAC with expiry)

- Good, because no table.
- Bad, because a stateless token cannot be revoked before expiry (ADR-070 clause 4) or
  show last use.

## Decision

Option 1. Purposes in use: `hive.reply`. Agency invites keep `hiring_agency_invites`
(domain fields) but mint and digest through the core. The legacy
`hive_escalation_reply_tokens` table is dropped once the new path is verified live.

## Consequences

- `resolveMagicLink` is the only way a public link resolves; rate limiting and `noindex`
  stay in the public route.
- `core_magic_links.token_hash` is a digest, not a secret (same reasoning as the
  `tokenHash` exception in `tests/contracts/scrub-completeness.test.ts`).
