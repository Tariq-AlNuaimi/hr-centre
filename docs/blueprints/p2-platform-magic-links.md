# P2 platform — one magic-link service (ADR-090)

Scope: lib/core/tokens/magic-link.ts, lib/hive/reply-token.ts, lib/hiring/agency-invites.ts, prisma/schema.prisma, prisma/migrations/20261029112022_core_magic_links/**, tests/contracts/core-magic-link.test.ts, tests/contracts/hive-reply-token.test.ts

Status: operator-approved P2 roadmap, item 5 (tokens). Audit: `ux/tickets-hiring.md` §2C-7, P2-6.
Feature parity: n/a — an internal security primitive, no user-facing feature.

## Why

The HR-ticket reply link (`EscalationReplyToken`) and the hiring agency link
(`HiringAgencyInvite`) re-implemented the same hashed, expiring, revocable bearer
token. Preboarding and the candidate status page need a third and fourth. One
audited primitive, one table for links that carry nothing but a subject.

## Stories and acceptance criteria

- **US-1 (module developer) mint a public link without re-deriving the security.**
  AC-1.1 `issueMagicLink({purpose, subjectId, ttlMs})` returns a 43-char base64url token
  and stores only its SHA-256 digest. AC-1.2 `resolveMagicLink(purpose, raw)` returns
  `{subjectId}` or `null` for malformed, unknown, wrong-purpose, expired and revoked alike;
  a malformed value costs no query and a failure writes nothing. AC-1.3
  `revokeMagicLinks(purpose, subjectId)` revokes every live link of that purpose with one
  audit row and no digest in it.
- **US-2 (employee) my existing reply link keeps working.** AC-2.1 The migration copies
  every `hive_escalation_reply_tokens` row into `core_magic_links` (purpose `hive.reply`)
  with the same digest, expiry, revocation and last use. AC-2.2 Every ADR-070 clause test
  passes against the core store.
- **US-3 (agency) my submission link keeps working.** AC-3.1 Agency tokens are minted and
  digested by the core primitive (same algorithm, so existing invites resolve). The invite
  row stays hiring's: it carries the agency, the cap and the role.

## Happy path

HR approve an answer → `issueReplyToken` → core link `hive.reply` → the employee opens
`/reply/<token>` → `resolveReplyToken` → the thread.

## Worst paths

- A token minted for `hive.reply` is tried on another purpose → `null`, nothing written.
- The old table holds a link at deploy → copied by the migration; it resolves after deploy.
- Copy collides on a digest (impossible in practice) → `ON CONFLICT DO NOTHING`, no failure.

## Data

`MagicLink` → `core_magic_links` (`purpose`, `subject_id`, unique `token_hash`,
`expires_at`, `revoked_at`, `last_used_at`, `created_by_id`). `subject_id` is a soft link —
the purpose names the table. The legacy `hive_escalation_reply_tokens` table is dropped in
a later slice, after the new path is verified live.

## For the features work

Preboarding and candidate status links: pick a purpose (`jml.preboarding`,
`hiring.status`), call `issueMagicLink` / `resolveMagicLink` / `revokeMagicLinks`, build
the URL with `magicLinkUrl(origin, path, raw)` from a server-configured origin, and keep
rate limiting + `noindex` in the public route.
