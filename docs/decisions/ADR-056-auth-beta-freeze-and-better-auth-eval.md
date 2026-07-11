# ADR-056 — Freeze the Auth.js v5 beta pin; track Better Auth as the successor

**Status:** Proposed
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The template's authentication floor is `next-auth@5.0.0-beta.31` (Auth.js v5) with
`@auth/prisma-adapter@^2.11.1`. Auth.js v5 has been in **beta since October 2023**
and there is **no stable GA ETA**. The v2 supply-chain deep cut
(`docs/research/v2/19-libraries-deep.md`, local scan 2026-07-11) surfaces this as a
**strategic + maintenance risk (P1)**, not a license or CVE risk — the pin's license
is clean (ISC) and `npm audit` is at 0 vulnerabilities:

- Lead maintainer **Balázs Orbán left in January 2025**, which contributed to v5
  stalling in beta.
- The **Auth.js core team joined Better Auth in September 2025**. Auth.js is now
  effectively **security-fixes-only**, and Better Auth (MIT) is "strongly recommended
  for new projects." An Auth.js→Better Auth migration guide exists.

So we ship a **beta** library as the security floor of a redistributed template, on
a project the original team has moved off of. Two independent hazards follow: (a)
**drift** — a floating beta range (`^5.0.0-beta`) would let an unvetted beta build
land under us via any `npm install`, on the single most security-sensitive dependency
in the tree; and (b) **strategic dead-end** — building new auth surface on a lib whose
maintainers have redirected their effort is throwing good work after a frozen API.

`lib/auth.ts` is on the **Ask-before** surface (CLAUDE.md). This ADR **records the
decision only** — it makes no code change. The 3-role `Role` enum and the auth
wrappers (`withAuth` / `withAdminAuth` / `withEditorAuth` / `withInternalAuth` /
`withApiAuth`) are the template's own trust-boundary primitives and are **kept
regardless of which library sits underneath** — a future Better Auth migration
re-implements the adapter beneath them, never the role model or the wrapper contract.

## Decision drivers

- **The auth lib is the security floor of a redistributed template** — a silent beta
  bump on a fork is the highest-blast-radius supply-chain event we can have; it must
  not be able to happen unattended.
- **Auth.js v5 is a beta with no GA and a redirected maintainer team** — currency
  ("stay in range," ADR-017) is the wrong instinct here; stability is what we want.
- **Don't churn a working auth stack reflexively** — a full library migration touches
  every route's trust boundary; it is a deliberate project, not a dependency bump.
- **Keep the template's own identity primitives stable** — the 3-role enum + wrappers
  are library-agnostic and must survive any swap so forks and ADR-024/ADR-045 hold.

## Considered options

### Option 1 — Freeze the exact beta pin AND open a tracked Better Auth evaluation (chosen)

Keep `next-auth` at the **exact** `5.0.0-beta.31` (no `^`, treat as frozen), and
record Better Auth as a **tracked evaluation with explicit revisit triggers** — not a
migration commitment. Keep the `Role` enum + auth wrappers unchanged.

- Good, because it removes the drift hazard immediately: an exact pin means no
  `npm install` on any fork can pull a newer, unvetted beta onto the security floor.
- Good, because it matches the actual state of the world — a beta with no GA is
  something you _hold_, not something you _track to latest_; ADR-017's "in-range
  continuously" is correctly overridden for this one dependency.
- Good, because it keeps the successor question _live_ (concrete triggers, a named
  candidate that absorbed Auth.js's own direction) without paying migration cost on a
  system that works today.
- Good, because it preserves the template's own primitives (enum + wrappers), so a
  later swap is an adapter-layer change, not a trust-boundary rewrite.
- Bad, because we sit on an unmaintained-direction beta for longer; security fixes to
  Auth.js still land, but no feature evolution does.
- Bad, because an exact pin needs a deliberate human bump if a security patch ships as
  a new beta — the manual-bump burden is the price of no drift (mitigated below).

### Option 2 — Migrate now to Better Auth

Rip out Auth.js and adopt Better Auth this phase.

- Good, because it lands on the maintained, recommended-for-new-projects successor and
  ends the beta-floor exposure outright.
- Bad, because it rewrites the auth trust boundary — every route, the adapter, the
  session/JWT model, the Entra OIDC wiring (ADR-024) and the Polis SSO/SCIM seam
  (ADR-045) — a large, high-risk change with no forcing function; violates "don't
  churn a working auth stack" and the auto-plan/Ask-before discipline.
- Bad, because Better Auth's own maturity for _our_ exact surface (Prisma adapter
  parity, Auth.js migration fidelity, enterprise SSO/SCIM story) is **unverified in
  session** — migrating before evaluating is a guess, the failure the blueprint/eval
  gates exist to prevent.
- Bad, because it would be undertaken while Auth.js still ships security patches — we'd
  be taking migration risk to escape a risk that is currently contained.

### Option 3 — Float the beta (`^5.0.0-beta`)

Let the beta range track upward like any other in-range dependency.

- Good, because security patches published as new betas arrive automatically.
- Bad, because it puts a **moving beta under the security floor** — the exact hazard
  §Context names; a fork's `npm install` could silently adopt an unvetted beta with a
  breaking change to auth. Directly contradicts decision-driver #1.
- Bad, because beta semver gives no stability guarantee between beta builds, so "in
  range" carries none of the safety it carries for a GA library.

### Option 4 — Pin and do nothing (no successor tracking)

Freeze `5.0.0-beta.31` and drop the successor question entirely.

- Good, because it is the least effort and removes drift.
- Bad, because it lets the strategic dead-end become a surprise — the day Auth.js GA
  slips indefinitely or a security cliff hits, we'd start the successor evaluation from
  zero, under pressure, with no pre-agreed triggers.
- Bad, because it ignores that Better Auth _absorbed Auth.js's own team and direction_;
  refusing to even track the named successor is willful blindness, not thrift.

## Decision

**Adopt Option 1.** Freeze `next-auth` at the exact `5.0.0-beta.31` (no caret; treat
it as a frozen dependency, overriding ADR-017's in-range-continuously default for this
one line) and open a **tracked evaluation of Better Auth** as the go-forward auth
library, gated by the explicit revisit triggers below. This is **not** a migration
commitment: no fork migrates reflexively, and no new auth surface is built on the beta
churn. Decision-driver #1 (the auth lib is the security floor, a silent beta bump is
the worst supply-chain event) and #3 (don't churn a working auth stack) together tip
it — Option 3 fails #1, Option 2 fails #3, Option 4 fails the successor-tracking half
of the problem.

The `Role` enum and the auth wrappers in `lib/api-helpers.ts` are **kept regardless of
library**. Any eventual Better Auth adoption re-implements the adapter beneath those
primitives; it does not touch the role model or the wrapper contract that every route
composes against.

Because `lib/auth.ts` and `package.json` are Ask-before / not-editable in this pass,
this ADR is the record; the exact-pin state (already `5.0.0-beta.31` with no `^`) and
the enum/wrapper invariants are affirmed here, not changed by it.

## Consequences

### Positive

- The single highest-blast-radius dependency can no longer drift onto a fork unattended
  — the exact pin closes the silent-beta-bump hazard.
- The successor question is kept live with a named candidate (the team that owns
  Auth.js's own direction) and concrete triggers, so a migration — if it happens — is a
  planned project, not a fire drill.
- Trust-boundary stability: the 3-role enum + wrappers are the durable contract; a
  library swap is an adapter change beneath them, insulating forks, ADR-024, and
  ADR-045.
- No migration risk taken this phase on a working, security-patched auth stack.

### Negative

- We remain on an unmaintained-direction beta longer; only security fixes flow into
  Auth.js, no feature evolution.
- An exact pin means a security patch shipped as a new beta requires a deliberate,
  reviewed human bump — no auto-currency for this line.
- The evaluation is deferred work; until a trigger fires, Better Auth's fit for our
  exact surface stays unverified.

### Mitigations

- **Watch, don't float:** let Renovate/Socket _propose_ a beta bump as a reviewed PR
  (min-release-age cooldown, `19-libraries-deep.md` §3) rather than a caret range
  auto-adopting it — currency-as-review, not currency-as-drift.
- **Pre-write the migration trigger list (below)** so the evaluation starts from agreed
  signals, not from a panic.
- **Keep new auth surface library-agnostic:** build against the wrappers + enum, never
  against Auth.js-v5-specific internals, so the eventual adapter swap is contained.
- When the evaluation does run, it goes through `/blueprint` + a plan (Ask-before
  surface) and the security-architect tier — this ADR does not pre-authorize a swap.

## Alternatives considered

See Considered options. In brief:

1. **Migrate now to Better Auth** — rewrites the auth trust boundary with no forcing
   function while Auth.js still ships security patches; the candidate's fit is
   unverified. Rejected as premature churn.
2. **Float the beta (`^5.0.0-beta`)** — puts a moving beta under the security floor;
   the precise drift hazard this ADR closes. Rejected.
3. **Pin and do nothing** — removes drift but drops the successor question, turning a
   known strategic dead-end into a future surprise. Rejected.

## Migration triggers

Revisit (open the Better Auth migration blueprint) when **any** fires:

- **Auth.js stable GA slips further or is abandoned** — the v5 GA ETA moves again, or
  the project formally declares maintenance-only/EOL with no GA intent.
- **A security cliff** — a security finding in `5.0.0-beta.31` (or its adapter) with no
  timely patched beta, OR the Auth.js security-patch stream itself goes quiet.
- **Better Auth clears a maturity bar for our surface** — a stable (non-beta) release
  with first-class Prisma-adapter parity, a proven Auth.js→Better Auth migration path,
  and enterprise SSO/OIDC + SCIM coverage that matches ADR-024/ADR-045, verified
  against our routes rather than assumed.
- **New auth surface is forced onto the beta** — a fork needs an auth capability that
  Auth.js v5's frozen beta can't provide; that need is the trigger to evaluate the
  successor rather than extend the beta.

Any migration that follows is a deliberate, blueprinted, plan-gated project on the
Ask-before surface — never an in-place dependency bump.

## Related

- **ADR-045** — Enterprise SSO (SAML→OIDC) + SCIM 2.0 via an Ory Polis sidecar; names
  the Auth.js→Better Auth rewrite as the tracked P1 and keeps Auth.js for v1 — this ADR
  is that P1's freeze-and-evaluate record.
- **ADR-024** — SSO via Microsoft Entra ID; the OIDC-direct reference the auth lib must
  keep supporting through any successor swap.
- **ADR-017** — dependency cadence (in-range continuously); this ADR is the explicit,
  scoped override for the `next-auth` beta line.
- `docs/research/v2/19-libraries-deep.md` — the P1 finding (§2, §5, verdict table): the
  Auth.js maintenance/strategic risk, the exact-pin recommendation, and Better Auth as
  the WATCH candidate.
