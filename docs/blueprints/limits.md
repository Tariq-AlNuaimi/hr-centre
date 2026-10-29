# Blueprint — Sign-in limits, access-filtered notices, real HTTP status codes

Scope: lib/rate-limit.ts, app/api/auth/**, app/api/logins/change-password/route.ts, app/api/users/[id]/password/route.ts, tests/contracts/auth-rate-limits.test.ts, docs/decisions/ADR-100-sign-in-and-password-rate-limits.md, SECURITY.md

Operator-approved hardening batch (2026-10-29). Three slices, each its own PR.

## Slice 1 — Login and password rate limits (ADR-100)

**Story.** As an employee signing in from the office (one NAT address shared by everyone),
I am not throttled because colleagues are signing in too; as the owner of an account, an
attacker cannot make more than a handful of guesses or reset emails against it per window,
whatever IPs they rotate through.

**ACs**

- AC-L1.1 `POST /api/auth/*`: 120/min per IP; a credentials sign-in also spends a
  10/min bucket keyed on the normalised (trimmed, lower-cased) email. 11th attempt on one
  account → 429 with `Retry-After`, and never reaches Auth.js.
- AC-L1.2 Password change (`PUT /api/users/[id]/password`, `POST /api/logins/change-password`):
  5/min per signed-in user (one bucket shared by both routes), 60/min per IP outside the
  auth wrapper.
- AC-L1.3 Forgot password: 3 per 15 min per address, 30/min per IP. Response stays neutral
  (no enumeration): the 429 depends only on request volume.
- AC-L1.4 Reset password: 30/min per IP; 3 per 15 min per account once a valid token names it.
- AC-L1.5 `lib/auth.ts` failed-login lockout unchanged.
- AC-L1.6 ADR + SECURITY.md record the numbers and that the in-memory limiter is
  per-instance (approximate across Vercel instances; Valkey / Upstash is the shared path).

**Happy path.** 40 people sign in at 09:00 from one office IP → all pass (≤120/min).
**Worst path.** Credential stuffing against one mailbox from rotating IPs → the account
bucket refuses the 11th try in the minute, and the lockout trips after 5 bad passwords.
Forgot-password spam to one mailbox → 3 emails per 15 min at most.
