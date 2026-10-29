# ADR-100 — Sign-in and password rate limits: wide per-IP, tight per-account

**Status:** Accepted — operator-approved proposal (2026-10-29)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

`POST /api/auth/*` was limited to 10/min per IP and the password routes to 5/min per IP.
A whole office signs in from one NAT address, so 10/min per IP is a real outage risk on a
Monday morning, while the IP key itself is only as good as the forwarding header it comes
from (SECURITY.md T-01): rotating it mints a fresh bucket. The control that survives
rotation is a per-ACCOUNT bucket. `lib/rate-limit.ts` already supported one (`subject`),
but only at the same limit as the IP bucket, and only forgot-password used it.

## Decision

Per-IP buckets become wide backstops; per-account buckets carry the security load. The
numbers live in one place, `AUTH_LIMITS` in `lib/rate-limit.ts`:

| Surface                                                                                                                            | Per account / user                | Per IP  |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| Login — any `POST /api/auth/*`; account bucket on the credentials sign-in                                                          | 10/min per normalised email       | 120/min |
| Password change — `PUT /api/users/[id]/password` and the forced first-login `POST /api/logins/change-password` (one shared bucket) | 5/min per signed-in user          | 60/min  |
| Forgot password — `POST /api/auth/forgot-password`                                                                                 | 3 per 15 min per normalised email | 30/min  |
| Reset password — `POST /api/auth/reset-password` (account = the valid token's owner)                                               | 3 per 15 min                      | 30/min  |

- `rateLimitSubject()` consumes a subject-only bucket, so the account quota can differ
  from the IP quota. Both buckets are always consumed (even when one already refused), and
  a refusal reports the later reset as `Retry-After`.
- The login email is read from a clone of the Auth.js form body (bodies over 8 KB are not
  parsed), so the handler still receives the request untouched.
- The per-user password bucket runs after `withAuth` (it needs the session); the per-IP
  backstop stays OUTSIDE the wrapper (`no-rate-limit-inside-auth`).
- `lib/account-lockout.ts` (5 bad passwords / 15 min, per email) is unchanged and still
  runs under login and password change.
- The reset-complete account bucket is consumed only once a valid token resolves to an
  account, so a stranger cannot burn it without holding the emailed link.

## Consequences

- **Approximate across instances.** On Vercel the limiter is in-memory per instance (no
  `VALKEY_URL` is set), so with N warm instances the effective ceiling is up to N × the
  configured number. The shared-state path is `VALKEY_URL` (ADR-035) or the Upstash
  `/scale-up` recipe (`docs/recipes/shared-security/1-account-lockout.md`).
- Per-account buckets are a targeted-lockout primitive: anyone who knows an address can
  spend its bucket. They are time-boxed (1 or 15 minutes), so the worst case is a delay.
  The forgot-password bucket (3 per 15 min) is the longest; a user who hits it waits.
- Contract tests: `tests/contracts/auth-rate-limits.test.ts` (every limit at its boundary,
  the route wiring, and the sign-in route end to end with Auth.js stubbed).
