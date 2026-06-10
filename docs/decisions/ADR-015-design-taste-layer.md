# ADR-015 — Design quality via a generation-time taste layer on AntD, not a stack swap

**Status:** Accepted
**Date:** 2026-06-10
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-001 (locked stack: Ant Design 6), ADR-007 (tiers), ADR-008 (UAT via Playwright). Does not supersede them.

## Context

UI/UX quality is a first-class concern for the prototype rail: stakeholders are
non-developers who judge a prototype by how it looks and feels in a shared URL.
Three external "design skills" were evaluated against the template, alongside a
market scan of the highest-rated options:

- **Taste Skill** (`Leonxlnx/taste-skill`, ~40k★) — anti-slop frontend rules + 3
  dials (variance/motion/density). Defaults to **Tailwind v4 + Motion/GSAP +
  custom fonts**, and its own scope statement **excludes dashboards, data tables,
  and multi-step product UI** — i.e. excludes this template's primary output.
- **claude-design-skill** (`jiji262`) — produces standalone **HTML artifacts**
  (decks, prototypes, posters), not integrated app code.
- **Impeccable** (`pbakaus/impeccable`, ~37k★) — 23 commands + a **41-rule
  deterministic slop detector** with a CLI scanner. Framework-agnostic advice,
  but the detector's compatibility with AntD's **CSS-in-JS runtime-injected
  styles** is unverified (its source-scan likely cannot see them; its
  `detect <url>` Puppeteer path renders the DOM and likely can).
- Market scan also surfaced **Anthropic's official `frontend-design`** skill
  (~565k installs — pure pre-code philosophy: commit to an aesthetic, banned
  default fonts/gradients), **Hallmark** (`Nutlope`, 22 themes + 65 slop-gates +
  portable `design.md`), and the **Tailwind/shadcn component ecosystem**
  (21st.dev, Magic UI, Aceternity, tweakcn, v0).

Two structural findings shaped the decision:

1. **Every *tooling-rich* design ecosystem is Tailwind/shadcn-coupled.** They emit
   Tailwind classes / shadcn source and are unusable on AntD without leaving it.
   Only the **pure-prompt, framework-agnostic** skills cross over to AntD.
2. **AntD caps differentiation** — its token system (Seed→Map→Alias) recolors and
   re-rounds cheaply, but AntD's own docs concede the wall ("when a Token does not
   support some configuration, developers become powerless"). That ceiling bites
   hardest on *marketing/brand* surfaces — exactly what the Tailwind tools target
   and what this template does **not** build. For **internal CRUD tools**, AntD's
   idiom (consistent tables/forms, complete states, built-in a11y + RTL) is an
   asset, not a liability.

An audit of the template's own design-quality layer found the *gate* side strong
(`/design-qa` → `/qa` → `/uat`, axe wired in, RTL+dark checks, scorecards against
`docs/uat-rubric.md`) but three gaps **upstream of the gate**:

- **No generation-time taste layer** — nothing steers the agent *before* it writes
  UI; the rubric *catches* slop but nothing *prevents* it.
- **No `tokens.css` / AntD token scale** — the rubric scores "on-token spacing
  (4/8px), `--density-*`" against a ruler that does not exist.
- **No `design/*` mockup mechanism** — `/design-qa` is built to diff against
  mockups that forks don't have.

## Decision

Keep ADR-001's AntD lock. Raise design quality by adding a **generation-time taste
layer** and closing the two foundational gaps, rather than adopting any external
skill wholesale or swapping to Tailwind/shadcn:

1. **Taste layer (the #1 gap).** Add a template-native "design direction" step that
   fires *before* UI is written, modeled on Anthropic's `frontend-design`
   philosophy (commit to an aesthetic; banned default fonts/gradients/cookie-cutter
   SaaS layouts) and the **stack-agnostic** rules harvested from Taste Skill and
   Hallmark — all expressed in **AntD-token language** (e.g. density via AntD
   compact/algorithm tokens, not Tailwind utilities). This lives in `/design-qa`
   and the rubric, not as a competing command surface.
2. **Token scale.** Create the missing `tokens.css` / AntD theme token scale
   (spacing 4/8, density vars, type scale) so the rubric's "on-token" heuristic has
   teeth and the agent has a fixed vocabulary to design against.
3. **Deterministic gate stays axe.** axe-core (already wired into `/design-qa`) is
   the one slop/a11y detector confirmed to work on AntD CSS-in-JS. Impeccable's
   detector is **spiked, not adopted**: run `npx impeccable detect <preview-url>`
   against a deployed Vercel preview (DOM-rendered path) and wire it into
   `/design-qa` *only if* it adds signal beyond axe; otherwise drop it.

None of the three evaluated skills is installed. Their *value is harvested*: rules
into the rubric, the detector into a spike. The Tailwind/shadcn ecosystem is
out of scope while ADR-001 holds.

## Consequences

### Positive
- The biggest real gap (no pre-code taste) is closed without a stack change, an
  ADR-001 rewrite, or losing AntD's built-in RTL/a11y/data components.
- The token scale makes an already-strong gate (`/design-qa`) enforceable instead
  of aspirational, and gives the agent a fixed design vocabulary.
- Zero new runtime dependencies; harvested rules are prompt text, and the detector
  is a dev-only `npx` spike (not a runtime dep, so no >50KB-dep ADR needed for it).
- Avoids running two competing QA systems — Impeccable's 23-command surface and
  `PRODUCT.md`/`DESIGN.md` are deliberately *not* adopted (they overlap `/qa` and
  `design/*`).

### Negative
- AntD's differentiation ceiling remains: the taste layer strips *generic* tells
  but the AntD idiom still shows through. Projects needing bespoke, consumer-grade
  brand UI will hit the wall regardless (see migration triggers).
- Harvested rules can drift from their upstream sources; they are restated in
  template terms, so the template — not the upstream repo — owns them.

### Mitigations
- A Tailwind escape-hatch and a full shadcn rail were both considered and are
  recorded as migration triggers, so the ceiling is a *known, revisitable* limit
  rather than a surprise.
- The Impeccable spike is time-boxed and reversible — it earns a place in the gate
  only on demonstrated signal.

## Alternatives considered
1. **Install Taste Skill / Impeccable wholesale.** Rejected: Taste defaults to
   Tailwind/GSAP and excludes dashboards (this template's core output); Impeccable
   ships a competing QA command set and `PRODUCT.md`/`DESIGN.md` that overlap `/qa`
   and `design/*`. Both fight ADR-001 or duplicate the existing rail.
2. **Swap to a Tailwind + shadcn/ui rail for maximum differentiation.** Rejected
   *for now*: a superseding-ADR-sized change that discards AntD's built-in RTL,
   a11y, and data-grid/form components — a poor trade for internal-tool prototypes
   whose value is clarity and speed, not brand novelty. Kept as a migration trigger.
3. **Hybrid: AntD base + Tailwind escape-hatch for hero/marketing surfaces.**
   Deferred: real power but adds a second styling system and toolchain weight to
   every fork for a surface this template rarely builds. Revisit if a fork's
   primary deliverable becomes a public marketing page.
4. **Status quo (rely on `/design-qa` alone).** Rejected: the gate catches slop but
   nothing prevents it, and it scores against a token scale that doesn't exist.

## Migration triggers
Revisit (toward alternative 2 or 3) when:
- A fork's primary deliverable becomes a **public, brand-differentiated** surface
  (marketing site, consumer product) rather than an internal tool — AntD's ceiling
  becomes the bottleneck.
- Stakeholders repeatedly reject prototypes as "looking like a generic admin panel"
  *after* the taste layer is applied.
- The Tailwind/shadcn tooling ecosystem (21st.dev, v0, Magic UI) becomes a hard
  requirement for a project's velocity.
- AntD 6 theming or RTL support stalls relative to the alternatives.

## Related
- `docs/decisions/ADR-001-template-baseline.md` — the AntD lock this preserves
- `docs/uat-rubric.md` — the design-QA heuristics the taste layer + token scale feed
- `.claude/skills/design-qa/SKILL.md` — where the taste layer and detector spike land
- `components/layout/ThemeProvider.tsx` — the AntD theme the token scale formalizes
