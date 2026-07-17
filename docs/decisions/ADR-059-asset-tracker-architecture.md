# ADR-059 — Asset Tracker: build approach (scaffold vs hand-build vs extend)

**Status:** Accepted (2026-07-17, Tariq Al-Naaimi — recorded via `/explore` during the V2-210 pilot)
**Date:** 2026-07-17
**Decision owner:** Tariq Al-Naaimi
**Relates to:** the Phase-2 pilot (V2-210), `docs/blueprints/asset-tracker.md`, `/explore` (V2-204),
`/scaffold-entity` (ADR-based entity generator).

## Context

The Phase-2 pilot builds an IT **Asset Tracker** to exercise the full loop. Before the blueprint
locked the architecture, `/explore` diverged on **how to build the entity** — the one real
architectural fork (the domain model itself is settled by the ITAM benchmark). This ADR records the
divergence + the rejected options so the choice is archaeological, per V2-204.

**Reference consulted:** Snipe-IT's asset model (OSS, `grokability/snipe-it`) — mined in
`docs/benchmarks/it-asset-management.md`. No same-stack (Next 16 + Prisma) asset-tracker OSS exists;
the template's own `/scaffold-entity` output is the closest same-stack reference.

## Considered options (the `/explore` trade-off, pillars-aligned)

| Option                              | Speed                   | Maintainable                                                                      | Scalable                               | Secure                                     | High-Quality                                |
| ----------------------------------- | ----------------------- | --------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| **1 — `/scaffold-entity` (chosen)** | ✅ minutes, one command | ✅ on-convention (audit/soft-delete/DataTable auto-wired)                         | ✅ list route bounded by the generator | ✅ auth wrappers + zod emitted             | ✅ honest states from the shared primitives |
| 2 — Hand-built bespoke service      | ❌ hours                | ⚠️ re-implements what the scaffold gives free; drifts from convention             | ⚠️ manual bounding                     | ⚠️ manual wrapper/zod wiring, easy to miss | ⚠️ hand-rolled states                       |
| 3 — Extend an existing entity       | ✅ if one fits          | ❌ no existing noun fits "hardware asset"; a forced fit is worse than a new model | —                                      | —                                          | ❌ semantic mismatch                        |

### Option 1 — `/scaffold-entity` (chosen)

Generate the `Asset` model + zod + routes + pages + recycling-bin registration from the ADR-based
generator, then layer the one bespoke invariant (status-transition rule) by hand.

- Good, because it is the fastest path to on-convention, gate-passing code (Speed + Maintainable).
- Good, because audit, soft-delete, and the shared `DataTable` come wired — the app-floor is pre-met.
- Bad, because the status-transition invariant (IN_STOCK→ASSIGNED→…) isn't expressible as a scaffold
  flag — it's a hand-added zod refinement + service check (small, localized).

### Option 2 — Hand-built bespoke service (rejected)

- Good, because total control of the shape.
- Bad, because it re-implements audit/soft-delete/route/zod wiring the scaffold gives for free — the
  exact duplication ADR-032 (build-vs-buy) exists to stop; slower and more error-prone on Secure.

### Option 3 — Extend an existing entity (rejected)

- Good, because no new model if one fit.
- Bad, because no existing noun models a hardware asset (checked `prisma/schema.prisma` +
  `docs/REPO-MAP.md`); forcing the fit would be a semantic mismatch worse than a clean new model.

## Decision

**Option 1** — scaffold `Asset`, then hand-add the status-transition invariant. The scaffold gives
the app-floor (audit/soft-delete/DataTable/recycling bin) for free and emits auth+zod on every route;
the only bespoke code is the localized state-machine refinement.

## Consequences

- Positive: fast, on-convention, gate-passing; the pilot spends its effort on the loop stations, not
  boilerplate.
- Negative: the status-transition rule is hand-added (not generated) — covered by a zod refinement +
  a service guard + a worst-path scenario (US7-worst).

## Related

- `docs/blueprints/asset-tracker.md` · `docs/benchmarks/it-asset-management.md` · ADR-032 (build-vs-buy)
