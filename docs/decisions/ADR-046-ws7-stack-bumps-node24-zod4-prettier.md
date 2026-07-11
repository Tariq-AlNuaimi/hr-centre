# ADR-046 — WS-7 stack bumps: Node 24, zod 4, Prettier + format gate

**Status:** Accepted (enterprise pivot, WS-7 stack bumps, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Supersedes / amends:** **ADR-001 (locked stack)** for the two MAJOR version
lines it pins — Node and zod. ADR-001 requires a superseding ADR before any
locked-stack change; this is it. The Next.js 16 / Prisma 7 / Auth.js v5 / Tailwind
pins are UNCHANGED.

## Context

The v2 enterprise benchmark flagged three stack-currency items (WS-7):

1. **Node 22 → 24.** Node 24 is the current LTS line; the Docker rail (ADR-030/035)
   already builds on `node:24.10.0` + `gcr.io/distroless/nodejs24-debian12`, so the
   RUNTIME is already 24 — only the developer/CI pins (`package.json` engines,
   `.nvmrc`, CI `node-version`) lagged at 20/22, an inconsistency that lets a
   contributor or CI run on a version the production image doesn't use.
2. **zod 3 → 4.** zod 4 (installed 4.4.3) is a major with a faster core and a
   cleaner top-level string-format API (`z.email()`/`z.url()` replacing the now-
   deprecated `z.string().email()`/`.url()`). It is the validation library on the
   Secure pillar's critical path (every API boundary), so staying current avoids
   deprecation drift and keeps the boundary contract idiomatic.
3. **No formatter.** The repo had lint (ESLint) but no formatter, so style was
   convention-by-review. A deterministic formatter + a `/ship` gate removes that
   class of review nit and diff noise.

## Decision

**Bump Node to 24 across all pins, migrate zod to 4, and adopt Prettier with a
`format` `/ship` gate.**

1. **Node 24.** `package.json` `engines.node` `>=24`, a `.nvmrc` of `24`, and every
   CI `node-version` set to `24`. The Dockerfile is untouched (already 24). No code
   change — Node 24 is backward-compatible with the 22 APIs this app uses.

2. **zod 4.** `zod@^4`. The only type-level break was the
   `@hookform/resolvers` v5 `zodResolver` generic in `components/shared/FormField.tsx`
   — resolvers v5 was already installed and is the _intended_ pairing with zod 4, so
   the v3-compat `as never` bridge was replaced with a constrained
   `TSchema extends ZodType<FieldValues>` generic (runtime unchanged). The schema
   surface (`lib/validations/*`, `lib/env.ts`, `lib/ai`, `lib/sso`, route schemas)
   is unchanged in SEMANTICS; the deprecated method-style string formats
   (`z.string().email()`/`.url()`) were migrated to the new top-level `z.email()`/
   `z.url()` to avoid deprecation drift. All contract tests + typecheck + build stay
   green.

3. **Prettier + `format` gate.** A minimal `.prettierrc.json` matching the existing
   house style (2-space, double quotes, semicolons, trailing commas) + a
   `.prettierignore` (build/generated/vendored dirs), `format`/`format:check` npm
   scripts, and a new `format` phase in `scripts/ship.mjs` (mirrors the `lint`
   gate: `prettier --check .` turns `/ship` RED on drift). The repo was normalized
   once with `prettier --write .` as the adoption commit so the gate starts green.

## Consequences

- **Positive.** Dev/CI/runtime Node versions are consistent (all 24); the validation
  boundary is on a current, faster zod with an idiomatic API; formatting is
  deterministic and gated, ending style-nit review churn and reducing diff noise.
- **Negative / risk.** zod 4 is a major: third-party libs that peer-depend on zod 3
  could type-conflict — mitigated because the only consumer coupling
  (`@hookform/resolvers`) was already v5 (zod-4-native), and `/ship` (typecheck +
  build + tests) is the gate that would catch any regression. The one-time
  `prettier --write .` produces a large formatting diff (expected for first
  adoption; isolated to its own change). Node 24 as a floor means a contributor on
  an older Node must upgrade (the `engines` field warns).

## Alternatives considered

- **Stay on zod 3 / Node 22.** Rejected: the benchmark's currency item, and zod 3's
  string-format API is now the deprecated path; drift compounds.
- **Biome instead of Prettier.** A faster all-in-one lint+format, but a larger
  disruption to the working ESLint setup (incl. the local `eslint-rules/` plugin at
  the heart of the Secure pillar). Prettier-alongside-ESLint is the lower-risk,
  reversible choice; Biome remains a future option.
- **eslint --fix only (no formatter).** ESLint isn't a formatter; it wouldn't cover
  the full style surface Prettier does. Rejected.

## References

- ADR-001 (locked stack) — the pin this ADR supersedes for Node + zod.
- ADR-030 / ADR-035 (Docker-first) — the runtime already on Node 24.
- Blueprint: `docs/blueprints/enterprise-ws7-stack-bumps.md`.
- zod 4 changelog (top-level string formats; deprecation of method-style).
