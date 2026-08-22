---
name: api-and-interface-design
description: Designs stable, hard-to-misuse interfaces before code is written -- route shapes, error contracts, pagination, TS type boundaries. Use when adding or changing an API route, a service signature, or a zod schema's shape, before /stack-advisor. Not for the auth/zod/rate-limit rules themselves (docs/rules/api-routes.md).
---

# API and Interface Design

> Adapted from [agent-skills](https://github.com/addyosmani/agent-skills) (`api-and-interface-design`, MIT), rewritten against this template's primitives per ADR-022.

## Overview

Good interfaces make the right thing easy and the wrong thing hard. Before a route
handler, a service function, or a shared type gets written, decide what it promises:
its shape, its error semantics, its stability guarantees. This repo's flow is fixed —
**UI → API route → service → Prisma**, only server components and API routes touch
`prisma` (`no-prisma-in-client`) — this skill is about designing what crosses each of
those seams *before* you write the handler, service function, or zod schema that
implements it.

Hyrum's Law still applies inside one codebase: every observable shape a page or a
teammate's route depends on — field names, error bodies, ordering — is a de facto
contract the moment something reads it, whether or not you called it "public."

## When to use

- Adding a new `app/api/**/route.ts` endpoint, or a new method on an existing one
- Defining a service function's signature (what it takes, what it returns, how it fails)
- Shaping a new zod schema in `lib/validations/` — what's required, what's optional, what's additive later
- Designing a shared component prop contract or a cross-module TS boundary
- Changing an existing route's request/response shape (this is where breakage hides)

**Not for:**
- The auth-wrapper/zod/rate-limit *rules themselves* — those are enforced, not designed;
  read `docs/rules/api-routes.md` (the wrapper table, `no-rate-limit-inside-auth`,
  `no-any-cast-on-session`) and link to it, never restate it here.
- Framework-correct patterns *while typing* the route — RSC read shape, Prisma
  pagination, index choices — that's `/stack-advisor`, pulled in after this design
  step, while the code is being written.
- Reviewing a finished diff — that's `/code-review` (pre-push) and
  `senior-code-reviewer` (post-push breadth).

## Steps

1. **Name the seam.** Is this UI→route, route→service, or a shared type? Only the
   first two cross a trust boundary (external input); the third is internal and
   doesn't need its own validation layer.
2. **Write the contract before the handler.** Input shape, output shape, and every
   error case — as a zod schema (`lib/validations/<domain>.ts`) plus a TS return
   type — before touching `route.ts`. The zod schema *is* the boundary validation
   `docs/rules/api-routes.md` requires; design it here, wire it there.
3. **Pick the auth wrapper the design implies**, don't default to `withAuth`: does
   this route need ADMIN (`withAdminAuth`), EDITOR-or-above (`withEditorAuth`), a
   machine caller (`withApiAuth`, the `/api/v1` seam), or a scheduler
   (`withInternalAuth`)? Name it in the design so the implementation isn't a guess.
   Full wrapper semantics live in `docs/rules/api-routes.md` — don't re-derive them.
4. **Specify every error case, not just the happy path.** Decide the shape once
   (this repo: `{ error: { code, message, details? } }` + status code) and reuse it
   for validation failure, not-found, conflict, and forbidden — a route that
   sometimes throws and sometimes returns `null` can't be consumed predictably.
5. **Decide list-route shape now: bounded or paginated.** `parsePagination` +
   `paginatedResponse` (`lib/pagination.ts`) is the default; a naked `findMany()`
   without `take`/`where` bounds fails the `/ship` scalability scan (Pillar 4)
   later — cheaper to decide the bound at design time than to retrofit it.
6. **Design for addition, not modification.** New fields optional; never repurpose
   or remove a field a page or another route already reads. If the shape must
   actually break, that's a new version or route, not a silent edit.
7. **Surface Ask-before items now, don't let them slide in during implementation.**
   A new public path, a new `/api/internal/*` route, or bypassing a wrapper is on
   CLAUDE.md's Ask-before list — flag it in the design conversation, before code
   makes it look like a fait accompli.
8. **Idempotency for state-changing routes under retry.** If a route can be retried
   (client timeout, queue redelivery), derive the dedup key from the intent
   (`` `charge:v1:${orderId}` ``), not the attempt (`randomUUID()`, a timestamp).
   Claim it via a unique constraint, not a check-then-insert. Decide the in-flight
   response (409 reject / bounded wait / 202+status) as part of the design, not an
   accident of whatever the first implementation does.
9. **Hand off to `/stack-advisor`** for the RSC/Prisma/Postgres shape that
   *implements* this design — pagination helper wiring, index choice, `select`
   columns.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "We'll add validation once it's wired up" | The zod schema is the contract — write it before the handler, not after. |
| "It's an internal route, it doesn't need a real contract" | Internal callers still break when the shape moves. Same discipline as `/api/v1`. |
| "We don't need pagination yet, the table's small" | `/ship`'s scalability scan doesn't care how small the table is today — bound it at design time. |
| "I'll pick whichever auth wrapper and fix it in review" | The wrapper is part of the interface's promise (who can call this). Decide it here; `/code-review` catches mistakes, not omissions of thought. |
| "Nobody outside this route reads that field" | Hyrum's Law: if a page or test reads it, it's already a commitment. |
| "The idempotency header is optional, we'll just document it" | Accepting the header without atomically claiming it tells retrying clients it's safe when it isn't. |
| "This is just a small edit to the response shape" | Small edits to an already-consumed shape are how a page silently breaks — additive fields only. |

## Red Flags

- A route designed with no explicit error-case list, only the happy path sketched
- A list/read endpoint with no pagination or bound decided before implementation
- A new `/api/internal/*` route or public path drafted without flagging the
  Ask-before gate first
- An auth wrapper chosen by copy-paste from the nearest route instead of by what
  this route actually needs
- A zod schema shaped to match the current UI form instead of the actual contract
  (extra/renamed fields the moment the form changes)
- An idempotency key derived from a UUID or timestamp regenerated per attempt
- Field removal or type change proposed on a route another page already consumes

## Verification

- [ ] Every route in this change names its auth wrapper (`withAuth`/`withAdminAuth`/`withEditorAuth`/`withInternalAuth`/`withApiAuth`) and states why
- [ ] Every input has a zod schema in `lib/validations/`, not ad-hoc parsing in the handler
- [ ] Error shapes are specified for every case (validation, not-found, conflict, forbidden) — not just the happy path
- [ ] Every list/read route is bounded or paginated (`parsePagination`/`paginatedResponse`) — `npm run ship`'s unbounded-query scan (Pillar 4) will fail a naked `findMany()` otherwise
- [ ] New fields are additive and optional; no field an existing consumer reads is renamed, retyped, or dropped
- [ ] Any public path, `/api/internal/*` route, or wrapper bypass was raised as an Ask-before item, not slipped in
- [ ] State-changing routes either specify idempotency-key handling (derivation, atomic claim, in-flight response) or are explicitly documented as unsafe to retry

## Related

- `docs/rules/api-routes.md` — the enforced rules this skill designs *toward*: wrapper table, `no-rate-limit-inside-auth`, `no-any-cast-on-session`, `no-bare-internal-route`. Read it, don't restate it.
- `/stack-advisor` — framework-correct implementation patterns (RSC read shape, Prisma pagination, indexes) once the contract from this skill is decided.
- `/code-review` (pre-push) and `senior-code-reviewer` (post-push) — review the finished diff; this skill runs before either, at design time.
- `lib/pagination.ts`, `lib/api-helpers.ts`, `lib/validations/*` — the primitives a designed contract wires into.
- `docs/REPO-MAP.md` — check before designing a new seam; it may already exist.
- CLAUDE.md "Ask before" — the list this skill's Step 7 exists to surface, not bypass.
