---
name: benchmark
description: Researches 3-5 mature products in a category and writes a sourced feature-parity matrix (table-stakes / differentiators / anti-features) to docs/benchmarks/. Use when asked what mature tools in a category actually have, or for a competitor feature comparison before designing a feature.
---

# /benchmark — Know what "complete" means before building

The failure this stops: building a category app from imagination, shipping half
the table-stakes a real product in that category has, and discovering the gap at
UAT (or worse, after handoff). Before pinning WHAT to build (`/blueprint`), pin
what MATURE products in the category already consider baseline. The output is a
committed, sourced parity matrix the blueprint traces its Feature-Parity section
against.

## Steps

1. **Take the category.** One noun phrase — "IT asset management", "applicant
   tracking", "help desk". Narrow it; "a tool for HR" is not a category.
2. **Check `docs/benchmarks/` FIRST.** If a matrix for this category exists and
   its `Refreshed:` date is **< 6 months** old, reuse it — don't re-research.
   Stale (≥ 6 months) → refresh it in place (keep the filename, bump `Refreshed:`).
   No file → continue.
3. **Research 3-5 mature products, AT LEAST ONE open-source.** Web-search the
   category leaders (CLAUDE.md market-benchmark rule). For the OSS one, **mine the
   real feature list from the source** — its actual routes, Prisma/SQL schema,
   settings screens, docs/wiki — **not** the marketing page (marketing oversells;
   the schema is the truth). Name the repo. A benchmark with zero OSS sources
   mined is not done.
4. **Write `docs/benchmarks/<category>.md`** as a parity matrix with three
   **labeled groups**, mirroring the format of
   `docs/benchmarks/enterprise-ui-and-app-skeleton.md` (read it for the column /
   heading conventions before writing):
   - **Table-stakes** — everyone in the category has it; its absence reads as
     broken. These are the MUST-build rows.
   - **Differentiators** — only some products have it; it's a wedge / a reason to
     pick one over another. Candidate scope, not baseline.
   - **Anti-features** — things mature products deliberately do NOT build (scope
     they refuse). These are the "don't gold-plate" guardrails.
   - **Every row cites its source** — product name or `owner/repo` (+ the
     schema/route/docs anchor for OSS). No unsourced rows.
5. **Note the downstream link.** This matrix feeds the blueprint's **Feature-
   Parity** section (V2-202): the full-track `/blueprint` for a category app
   traces its user stories against the table-stakes rows here, so a missing
   baseline feature surfaces as a gap at spec time, not at QA.

## Rules

- **Every row is sourced** — a product name or `owner/repo`, ideally with the
  anchor (schema table, route, settings page, doc URL). No unsourced claims.
- **≥1 OSS source mined for real** — routes/schema/settings, not the marketing
  page. Name the repo. This is the anti-hallucination floor of the whole skill.
- **A `Refreshed: YYYY-MM-DD` line drives staleness.** Put it near the top. Step 2
  reads it; keep it honest (bump only when you actually re-research).
- 3-5 products, not 1 and not 12 — enough to see the convergent baseline, few
  enough to mine each properly.

## Skip when

- The category already has a **fresh** matrix (`Refreshed:` < 6 months) — open it,
  don't rewrite (step 2).
- A one-off throwaway that will never be benchmarked or re-built — a `/quickstart`
  toy with no category leaders to learn from. (A real category app is never this;
  don't use "it's a prototype" to skip the parity check.)

## Verification

Before calling this done:

- [ ] `docs/benchmarks/<category>.md` is committed with a `Refreshed: YYYY-MM-DD`
      line near the top
- [ ] ≥1 OSS product is mined for real — named repo, with the schema/route/docs
      anchor cited, not just its marketing page
- [ ] Every row cites a source (product name or `owner/repo`) — no unsourced rows
- [ ] The three labeled groups (table-stakes / differentiators / anti-features)
      are all present

**Emits:** a committed `docs/benchmarks/<category>.md`.

## Related

- `/blueprint` (full track) — consumes this matrix as its Feature-Parity source
  (V2-202); the table-stakes rows become the user-story baseline.
- CLAUDE.md "Market benchmark before building" — this skill is the mechanized,
  committed form of that standing instruction for whole-category work.
