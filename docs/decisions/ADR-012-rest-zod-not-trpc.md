# ADR-012 — Stay REST + zod (with an OpenAPI seam at handoff), not tRPC

**Status:** Accepted
**Date:** 2026-06-04
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-001 (zod at the API boundary), ADR-006 (prototype rail → IT handoff). Does not supersede them.

## Context

Another "SaaS-readiness" question is whether the template should adopt **tRPC**
for its client↔server API. tRPC offers end-to-end type inference between a
Next.js frontend and its server procedures, which is attractive for a
single-team, single-repo app.

The template's API shape today is plain **REST**: `app/api/**/route.ts`
handlers wrapped with `withAuth` / `withAdminAuth` / `withInternalAuth`, with
**zod** validating every request at the boundary (`lib/validations/`). This is
the ADR-001 invariant ("Validate at the API boundary with zod").

The decisive constraint is **ADR-006's handoff model**: the prototype is _not_
the artifact that ships to production. A **different IT team**, working in a
**different repo** with their **own** stack, takes over at `/handoff`. The API
surface is the thing they inherit and re-implement or wrap. Whatever the
template chooses, the IT team must be able to read it without learning a
template-specific RPC framework.

## Decision

**The template stays REST + zod.** The public API is plain HTTP routes with
zod-validated boundaries. tRPC is **not** adopted.

The seam for external/programmatic consumers is **OpenAPI at handoff**: because
every route already validates with zod, the request/response contracts can be
expressed as an OpenAPI spec (zod → JSON Schema is mechanical) when a fork needs
one, without changing the runtime. The REST surface is also versioned for stable
external consumption — see ADR-013.

## Consequences

### Positive

- **Handoff-friendly.** REST + zod is universally legible: the IT team reads
  `route.ts` + the zod schema and knows the contract, with no tRPC runtime,
  client, or React-Query coupling to port.
- **No cross-app refactor.** Adopting tRPC later would mean rewriting every
  route as a procedure and re-wiring the client — exactly the kind of churn the
  prototype→handoff model is designed to avoid.
- **Tooling reach.** Any HTTP client (curl, Postman, another service, a
  non-TypeScript consumer) calls the API directly; tRPC's ergonomics assume a
  TypeScript client.
- **The zod boundary is already there**, so the OpenAPI seam is additive, not a
  rewrite.

### Negative

- No automatic end-to-end type inference from server to client — the frontend
  restates response types (or derives them from the zod schemas). For an
  internal-tool prototype with a small surface this is a minor cost.
- Slightly more boilerplate per route than a tRPC procedure.

### Mitigations

- zod schemas are the single source of truth: the client can `z.infer` the same
  schemas the server validates with, recovering most of the type safety without
  the framework.
- `/scaffold-entity` generates the route + zod schema together, so the
  per-route boilerplate is automated.

## Alternatives considered

1. **tRPC.** Rejected: ties the API to a TypeScript-client-specific RPC runtime
   and would force a cross-app refactor of every route + the client; hostile to
   the IT handoff, where the consumer is a different team on a different stack.
2. **GraphQL.** Rejected: heavier schema/runtime surface than an internal-tool
   prototype needs, and an even larger thing to hand off.
3. **REST with no schema layer.** Rejected: violates the ADR-001 zod-at-the-
   boundary invariant and removes the basis for the OpenAPI seam.

## Migration triggers

Revisit when:

- A fork becomes a single long-lived TypeScript-only product (no IT handoff, one
  team owns client + server) where end-to-end inference pays for itself — that
  fork may adopt tRPC via its own superseding ADR.
- External consumers need a published, contract-tested API → generate the
  OpenAPI spec from the existing zod schemas (the seam this ADR preserves) rather
  than switching frameworks.

## Related

- `docs/decisions/ADR-001-template-baseline.md` — zod-at-the-boundary invariant
- `docs/decisions/ADR-006-pivot-to-vercel-neon.md` — prototype → IT handoff model
- `docs/decisions/ADR-013-api-versioning-and-seams.md` — `/api/v1/*` + auth seams
- `CLAUDE.md` — hard rules ("Validate at the API boundary with zod")
