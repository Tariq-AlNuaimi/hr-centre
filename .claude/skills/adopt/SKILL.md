---
name: adopt
description: Adopt an external capability the reuse-first way. Looks it up in docs/oss-catalog.md (step 0 of the build-vs-buy scan, ADR-032), surfaces the in-stack / self-host-OSS / SaaS / build-thin trade-off via AskUserQuestion (license, weight, data-egress, self-host), then on the operator's choice writes the docs/build-vs-buy-ledger.md entry + an ADR stub for a runtime dep and installs per the recipe. Use when the user says "adopt X", "should we use <library> for Y", "/adopt", or when a build-vs-buy gate denies a new lib/ file.
---

# /adopt — reuse before you build, on the record

The failure this stops: hand-building a capability an OSS project or a `/scale-up`
recipe already solves, or adopting a dependency without weighing license / weight /
data-egress until it's load-bearing. `/adopt` makes the catalog the first stop and
the ledger the receipt — it IS the ADR-032 scan, run as a skill.

## Steps

1. **Name the capability.** One noun phrase — "file uploads", "feature flags",
   "rich-text editor", "e-signature". Narrow it.

2. **Look it up in `docs/oss-catalog.md` FIRST (step 0).** This is the reuse scan's
   first move, not a formality.
   - **Hit** → read the row: the in-stack default, the self-host OSS option (+
     license), the SaaS option, and the verdict/pointer. The reuse question is
     already half-answered.
   - **Miss** → do the full ADR-032 scan (`docs/REPO-MAP.md` + `lib/` +
     `components/shared/` → the `/scale-up` recipe table → a web search for a
     library/OSS fit, weighed against the Ask-before ">50 KB runtime dep" line).
     Then **add the row you wished existed** to `docs/oss-catalog.md` in this change.

3. **Surface the trade-off with `AskUserQuestion`.** Present the real options as
   choices, each with its consequence — never silently pick a runtime dep:
   - **Use in-stack** (already shipped — no adoption) ·
   - **Adopt OSS self-host** (a fork owns + runs it; no data leaves the box; license
     flag — AGPL obliges source release if you fork/serve modified) ·
   - **Adopt SaaS** (fastest; a `/scale-up` recipe; publishes data off-box — an
     external dependency) ·
   - **Build a thin in-repo seam** (smallest surface; you own the maintenance).
     Call out: license, minified weight (`npm view <pkg> dist.unpackedSize`), whether it
     self-hosts, and what data crosses a trust boundary (SECURITY.md). For a **runtime
     dep > 50 KB** or an **AGPL fork**, this is an Ask-before decision (CLAUDE.md) — get
     explicit sign-off.

4. **Record the decision (the gate requires it BEFORE the file lands).**
   - Append a `docs/build-vs-buy-ledger.md` entry: a `Scope:` glob covering the new
     file(s), a `Considered:` line naming ≥1 real alternative (V2-309 requires it),
     and the `Decision:` with the reason. `build-vs-buy-gate.mjs` denies the new
     `lib/` (and, per V2-309, `components/shared/` + `scripts/`) file until this exists.
   - For a **runtime dependency**, also write an ADR stub in `docs/decisions/`
     (`/adr`) — the locked-stack change or the new external dependency is an
     architectural decision, not a silent `npm i`.

5. **Install per the recipe.** Follow the catalog/`scale-up` recipe: `npm i` the dep
   (or wire the SaaS env vars), add the thin `lib/<area>/` seam, compose the
   auth-wrapper / zod-boundary / audit invariants the template requires. No
   restructuring — every recipe is additive.

6. **Verify.** `/ship` green (the ledger/ADR gates + knip's no-dead-dependency floor
   all pass), and the capability works when RUN, not assumed.

## Skip-when

- The capability is already in-stack (the catalog says `use`) — just use the shipped
  primitive; no ledger entry, no ADR. `/adopt` is for a genuine new adoption.
- A pure dev-tool / one-off script with no runtime footprint — record it in the ledger
  if it's a new `scripts/` capability (V2-309), but no ADR.

## Worked example

`/adopt "distributed rate limit"` → catalog hit (`rate-limiter-flexible` + Valkey, BSD,
self-host; vs Upstash SaaS; vs the in-memory bucket that breaks past one replica) →
AskUserQuestion picks self-host OSS for data-residency → ledger entry
`Scope: lib/rate-limit/**` with the `Considered:` line + ADR-035 → `npm i
rate-limiter-flexible`, thin `lib/valkey.ts` client, `withRateLimit` composed outside
the auth wrapper → `/ship` green.
