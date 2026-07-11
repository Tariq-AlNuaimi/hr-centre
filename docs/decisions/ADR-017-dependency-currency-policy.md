# ADR-017 — Dependency currency policy: continuous in-range, quarterly majors

**Status:** Accepted
**Date:** 2026-06-12
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relates to:** ADR-001 (locked stack), ADR-007 (solo rail), SECURITY.md §13 (CVE remediations)

## Context

ADR-001 locks the stack: major-version bumps of core dependencies require a superseding
ADR. That is the right control, but without a cadence it decays into "never": by June
2026 the template had drifted a full major behind on zod, recharts, ESLint, TypeScript,
and jsdom, and Dependabot kept proposing exactly the majors the lock forbids — noise
branches that accumulated until a manual sweep deleted 17 of them. Meanwhile in-range
updates (minors/patches) are cheap, safe behind `/ship`, and where most security fixes
land.

The operator is a solo non-developer; the agent does the maintenance. The policy must
therefore be executable by the agent on a calendar, not dependent on someone "feeling
like upgrading".

## Decision

Two tracks, different cadences:

1. **In-range (minor/patch): continuously.** Any session doing non-trivial work may run
   `npm update` (and the deliberate `next` patch bump, exact pin preserved) when
   `npm outdated` shows drift, as its own commit, gated by a full `/ship`. Dependabot's
   grouped `minor-and-patch` PR covers the same ground once CI is active.
2. **Majors: a quarterly "stack refresh" pass.** Roughly every 3 months (or when a
   security advisory forces it), one session reviews all held majors **together**,
   writes ONE superseding ADR for the batch it adopts (with migration notes per
   package), and lands it behind a full `/ship` + `/qa`. Holding a major is fine;
   holding it silently for a year is not — the quarterly pass forces the look.

Dependabot is configured (`.github/dependabot.yml` `ignore` list) to **not** propose
the ADR-locked majors or the exact-pinned `next` toolchain, so its PRs are only ever
things the agent could merge without an ADR.

## Consequences

### Positive

- Security patches arrive continuously instead of batching up behind fear of majors.
- Major drift is bounded at ~one quarter, so each refresh is a small, documented step.
- Dependabot output becomes 100% actionable; no perpetual "won't fix" branches.

### Negative

- Quarterly refresh is a calendar obligation with no automated reminder on the free
  plan (no CI cron). It relies on the operator/agent noticing the date.

### Mitigations

- The session-start drift check + `npm outdated` in any maintenance session surface
  staleness organically even if a quarter slips.

## Alternatives considered

1. **Track latest everything, always** — churn and breakage risk outweigh benefit for a
   prototype rail; majors like zod 4 change APIs used at every boundary.
2. **Freeze until forced by a CVE** — the status quo that produced 5 held majors and 17
   stale branches; reactive upgrades under CVE pressure are the worst time to do them.

## Migration triggers

- CI activation at `/handoff`: revisit whether Dependabot + required checks can replace
  the manual in-range track.
- A held major reaching end-of-security-support flips it from "quarterly candidate" to
  "immediate ADR".

## Related

- ADR-001 — the lock this policy adds a cadence to.
- `.github/dependabot.yml` — the ignore list implementing track 2's noise control.
