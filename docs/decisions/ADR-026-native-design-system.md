# ADR-026 — A native design system over importing external design skills

**Status:** Accepted
**Date:** 2026-06-25
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

Recurring operator complaint: improvised UI lands ugly and only gets fixed at QA
("the UI is horrible"). The template already locked the **ruler** — design tokens
(`app/tokens.css`, `antd-theme.ts`), the `no-raw-hex-color` ESLint rule, and the
anti-slop rubric (`docs/uat-rubric.md` Tier 0) — and shipped the **reactive** half
(`/design-qa`, which screenshots every screen/state, runs axe, and scores against
the rubric). What was missing was the **proactive** half: a repeatable way to
produce a good screen on the _first_ pass, so `/design-qa` has little to flag.

The obvious shortcut was to import an external, off-the-shelf design skill/pack
(several exist as Claude Code plugins). But the template already made the
analogous call in ADR-022 (cross-session memory + model routing): it built those
natively rather than adopting a third-party harness, on consistency,
supply-chain, and egress grounds. The design layer raised the same question.

## Decision

Build the proactive design layer **natively**, as first-party harness files,
rather than importing an external design skill:

- **`/design-system`** (`.claude/skills/design-system/SKILL.md`) — the proactive
  front half: declare the design read (surface · audience · tone · density · the
  one primary action), then build from vetted recipes on the shipped
  `components/shared/*` primitives, on-token and RTL/dark/a11y-correct.
- **`docs/design-recipes.md`** — copy-paste patterns for the recurring surfaces
  (page header, data table, form, filter bar, modal, empty/loading/error states),
  each distilled from a documented **market scan** (Ant Design / Material /
  Polaris / Carbon guidelines, WCAG 2.2 AA, Anthropic's design rules + frontend
  aesthetics cookbook) — honoring the CLAUDE.md market-benchmark rule.

The two pair with the existing pieces: `/design-system` (prevent) →
`/design-qa` (audit) → the rubric (score), all reading the same tokens and
primitives. The design read is the same declaration the `/blueprint` lightweight
track already asks for, so the layers compose instead of duplicating.

## Consequences

### Positive

- One internally-consistent system: the proactive recipes, the reactive audit,
  and the locked tokens/rules all reference the same ruler and primitives.
- No new third-party dependency, supply-chain surface, or off-Anthropic egress
  (consistent with ADR-022's reasoning).
- The recipes are tuned to _this_ stack (AntD 6 + next-intl RTL + dark hold +
  the shipped shared components), not a generic design pack that would fight it.

### Negative

- We own and maintain the recipes; they can drift from AntD/library updates and
  must be refreshed as the design language evolves.
- We forgo whatever breadth a large external design pack might offer.

### Mitigations

- The recipes are built on the shipped primitives, so a primitive change updates
  every recipe at once; the market-scan note records what to re-check on refresh.
- `/design-qa` is the backstop — anything the recipes miss is caught reactively
  and fed back into the recipes.

## Alternatives considered

1. **Import an external design skill/plugin.** Rejected — inconsistent with
   ADR-022's native-over-imported stance; adds supply-chain/egress surface; a
   generic pack would not be tuned to AntD + RTL + the shipped primitives.
2. **Rely on `/design-qa` alone (reactive only).** Rejected — fixing slop at QA
   is the exact loop this set out to break; prevention is cheaper than rework.
3. **Tokens + rules only, no recipes.** Rejected — a ruler tells you _when_
   you're off, not _how_ to build it right the first time.

## Migration triggers

- A major AntD/design-library version or a token-system overhaul → refresh the
  recipes against the new guidelines.
- If a high-quality, vetted external design system with acceptable egress/supply
  -chain posture emerges and our recipes become a maintenance burden, revisit.

## Related

- `.claude/skills/design-system/SKILL.md`, `docs/design-recipes.md`
- `.claude/skills/design-qa/SKILL.md`, `docs/uat-rubric.md` (Tier 0 anti-slop)
- `app/tokens.css`, `antd-theme.ts`, the `no-raw-hex-color` rule (ADR-015)
- ADR-022 (native agent memory / model routing — same native-over-imported call)
- ADR-025 (tiered enforcement gates) — the other half of the harness-hardening sweep
