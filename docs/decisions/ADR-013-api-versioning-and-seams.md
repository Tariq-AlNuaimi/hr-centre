# ADR-013 — Public API versioning (`/api/v1/*`) and the auth/SSO seams

**Status:** Accepted
**Date:** 2026-06-04
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-001 (auth wrappers, zod boundary), ADR-006 (handoff), ADR-012 (REST + zod). Does not supersede them.

## Context

The template's routes live at `app/api/**/route.ts` and serve `/api/<path>`.
That path is the *internal* layout of the App Router. When a fork grows an
**external consumer** — another service, a partner integration, a programmatic
client — exposing it directly at `/api/<path>` couples that consumer to the
internal route structure: any reorganization is a breaking change for them, and
there is no agreed-upon path under which to ship a v2 without churning every
route folder.

Two further "SaaS-readiness" gaps recur:
- **Programmatic (non-session) auth.** `withAuth` resolves an Auth.js *session*
  (cookie/JWT) — correct for the browser UI, but a machine consumer needs a
  Bearer-token path.
- **SSO role mapping.** When a fork fronts auth with an SSO/OIDC provider, the
  provider's groups/claims must map onto the template's `Role` enum
  (ADMIN / EDITOR / VIEWER) in one well-known place rather than ad hoc per route.

## Decision

**The public API is exposed under a stable, versioned prefix `/api/v1/*`,
implemented as a `next.config.ts` rewrite** (`/api/v1/:path*` → `/api/:path*`;
`middleware.ts` lets `/api/v1/*` pass through so the rewrite resolves before the
session gate). External consumers call the versioned path; the
internal route folders stay at `app/api/**` and can be reorganized freely
behind the rewrite. A future breaking surface ships as `/api/v2/*` (a second
rewrite) with zero churn to existing `v1` routes.

Two **library seams** are recorded for when a fork needs them (they are seams,
not day-zero features):
- **`withApiAuth` (Bearer).** A sibling wrapper to `withAuth` that authenticates
  a machine consumer via a `Authorization: Bearer <token>` header (a hashed API
  key / personal access token), resolving to the same context shape the audit
  extension expects. It is the programmatic counterpart to the session-based
  wrappers; it does **not** replace them for the browser UI.
- **SSO role mapping.** A single mapping point in `lib/` translates an
  SSO/OIDC provider's groups/claims into the template's `Role` enum, so role
  derivation lives in one place and the `no-any-cast-on-session` /
  role-checking invariants (ADR-001) still hold.

These seams keep the API REST + zod (ADR-012) and handoff-legible (ADR-006):
the versioned prefix is the only stable contract the IT team and external
consumers depend on.

## Consequences

### Positive
- **Stable external contract.** Consumers depend on `/api/v1/*`, decoupled from
  the internal `app/api/**` layout; routes can be refactored without breaking
  them.
- **Zero-churn versioning.** A breaking change is a new `/api/v2/*` rewrite, not
  a rename of existing route folders. `v1` keeps serving during the transition.
- **Rewrite, not duplication.** One `next.config.ts` rewrite covers the whole
  surface — no per-route version boilerplate, no copied handlers.
- **Named seams** (`withApiAuth`, SSO role mapping) give forks a documented place
  to add machine auth and SSO without re-litigating the auth model.

### Negative
- The rewrite is config-level indirection: a reader must know `/api/v1/*` maps to
  `app/api/**`. Documented here and in `CLAUDE.md`.
- `withApiAuth` and SSO mapping are seams, not shipped implementations; a fork
  that needs them must implement against the seam (rate-limit the Bearer path,
  store hashed keys, etc.).

### Mitigations
- Keep the rewrite a simple `:path*` passthrough so the mental model is "strip
  `/v1`"; reserve `/v2` for genuinely breaking changes.
- When `withApiAuth` is implemented, it reuses `lib/rate-limit.ts` and the audit
  context so the security floor (ADR-001) is inherited, and any Bearer secret is
  classified Restricted in `SECURITY.md` §1.

## Alternatives considered
1. **Serve routes directly at `/api/<path>` (no version prefix).** Rejected:
   couples external consumers to the internal route layout; no clean path to ship
   a v2.
2. **Per-version route folders (`app/api/v1/**`, `app/api/v2/**`).** Rejected:
   duplicates handlers and version-stamps every folder; the rewrite achieves the
   same stable surface with one line of config.
3. **Header- or query-based versioning.** Rejected: less discoverable and harder
   for third parties to cache/route than a path prefix.
4. **Overload `withAuth` to also accept Bearer tokens.** Rejected: mixing session
   and machine auth in one wrapper blurs the audit-attribution and rate-limit
   stories; a dedicated `withApiAuth` keeps each path's threat model clear.

## Migration triggers
Revisit when:
- A backward-incompatible change is needed → introduce `/api/v2/*` (second
  rewrite) and deprecate `v1` on a timeline.
- A fork onboards a machine/external consumer → implement `withApiAuth` against
  the Bearer seam (hashed keys, rate limit, Restricted classification).
- A fork moves to SSO/OIDC → implement the role-mapping seam and update how roles
  are checked (an ADR-001 "ask before" item).

## Related
- `docs/decisions/ADR-012-rest-zod-not-trpc.md` — REST + zod + the OpenAPI seam
- `docs/decisions/ADR-001-template-baseline.md` — auth wrappers, `Role` enum, zod boundary
- `docs/decisions/ADR-006-pivot-to-vercel-neon.md` — handoff model
- `next.config.ts` — the `/api/v1/:path*` → `/api/:path*` rewrite (implemented)
- `CLAUDE.md` — auth-wrapper hard rules; "ask before" (new public path, role changes)
