# Blueprint — HR Centre foundation, slice F-d (logins until SSO)

Scope: lib/people/logins.ts, lib/people/force-change.ts, lib/validations/login.ts, lib/auth.ts, middleware.ts, app/api/logins/**, app/[locale]/(auth)/change-password/**, app/[locale]/(dashboard)/people/**, components/people/**, prisma/schema.prisma

Status: SIGNED OFF as part of `docs/blueprints/hr-centre-foundation.md` (operator,
2026-10-26). Stories and acceptance criteria are the parent's **US-F4**
(AC-F4.1–AC-F4.3) and §4; the operator authorised touching `lib/auth.ts` and
`middleware.ts` for the forced change.

## What this slice delivers

- `User.mustChangePassword` (migration 20261026200000, additive with default).
- Create / Reset / Disable login on the employee record for whoever holds
  `logins.manage` for that person's scope. Eligible: HR role holders (any active
  role assignment) and line managers (anyone with direct reports); the API
  refuses others with a sentence.
- Temporary password: 16 symbols from an unambiguous alphabet (≈92 bits),
  generated server-side, returned once with `Cache-Control: no-store`, stored
  only as its Argon2 hash. It lives in the panel's state only while the dialog is
  open; reload loses it (AC-F4.1).
- Forced change (AC-F4.2): the Auth.js jwt callback already re-reads the user on
  every request; it now carries `mustChangePassword` into the session, and
  middleware sends every page to `/change-password` and answers every API with
  403 except the change-password API and Auth.js itself
  (`lib/people/force-change.ts`, unit-tested).
- Every issue, reset, disable and self-change stamps `passwordChangedAt`, so
  older sessions die on their next request (an intercepted temporary password
  stops working once changed or reset).

## Build notes

- Disable removes the password (a passwordless account cannot sign in —
  ADR-069) and keeps the account so SSO can link it later. Refused for yourself,
  for the last platform admin who can sign in, and if it would leave nobody
  holding HR access administration (F-c guard).
- Leavers already lose their login in the existing departure flow (the account
  is soft-deleted); a revoked account must be restored from the recycling bin
  before a password can be issued.
- Rate limits: issue/reset/disable 10 per minute, self-change 5 per minute.
