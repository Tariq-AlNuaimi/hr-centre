# ADR-027 — UI library direction & standard app skeleton

**Status:** Accepted
**Date:** 2026-06-25
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Relation to ADR-001:** the ADR-001 UI line (`UI: Ant Design 6`) **stands** — see the 2026-06-25 decision note below.

> **2026-06-25 — Operator decision (Part 1):** **Keep Ant Design 6; do NOT swap the UI library.** Instead of
> migrating to shadcn/MUI/Mantine, invest in a **token-level aesthetic elevation of AntD** to reach a "peak"
> enterprise look — delivered in `components/layout/antd-theme.ts` + `app/tokens.css` + `app/globals.css` +
> shell polish (refined indigo accent, softer radius, premium type stack/weights, roomier controls, layered
> soft elevation, refined per-mode neutrals, polished menu-selection + header brand mark). The library
> comparison below is retained as the record of *why* a swap was considered and deferred, and as the basis
> if the question is reopened (see Migration triggers). Part 2 (standard app skeleton) is unchanged.

## Context

Two operator requests drove a market-benchmark pass (CLAUDE.md "Market benchmark before building"):
1. Replace Ant Design with a **more attractive, enterprise-grade** UI layer.
2. Define a **standard app skeleton** (sections, settings, RBAC, dashboards) so any fork starts from a
   benchmark structure.

Full research (10 UI libraries + the IA of 10 enterprise apps + 11 admin-starter repos) lives in
`docs/benchmarks/enterprise-ui-and-app-skeleton.md`. AntD is part of the ADR-001 locked stack, so a swap is
an Ask-before change requiring this superseding ADR + sign-off. AntD's known costs today: a dated
"enterprise-admin" aesthetic, historically weaker ARIA, and **CSS-in-JS that forces `'unsafe-inline'` on our
CSP** (ADR-001 Consequences). The skeleton work is UI-agnostic and proceeds regardless of the library choice.

## Decision

### Part 1 — UI library (recommendation; pick one before building)

The realistic field narrows to three, compared head-to-head on what this template actually needs
(attractive · RSC-native · RTL `ar` · axe-clean · forkable · enterprise data tables · migration risk):

| Criterion | **shadcn/ui + Tremor** *(recommended)* | **MUI** | **Mantine** |
|---|---|---|---|
| Aesthetic vs AntD | ▲▲ most modern, "own product" look | ▲ polished but recognizably Material | ▲ clean, modern |
| RSC / App Router | ▲▲ best-in-class (no runtime CSS) | ○ client-side Emotion | ▲ strong (CSS Modules, no runtime) |
| RTL (`ar`) | ▲ native (`--rtl`, Radix DirectionProvider) | ▲ mature (stylis-plugin-rtl) | ▲ supported |
| Accessibility | ▲▲ Radix-grade (improves on AntD) | ▲▲ long-standing | ▲ good |
| Enterprise data table | ○ assemble (TanStack Table) | ▲▲ best grid in React (near drop-in) | ▲ built-in DataTable |
| Batteries-included | ○ copy-in, you assemble | ▲▲ everything included | ▲▲ everything included |
| CSP impact | ▲▲ can **drop `'unsafe-inline'`** | ○ keeps inline styles | ○ keeps inline styles |
| Licensing / lock-in | ▲▲ MIT, **you own the code** | ▲ MIT core; **MUI X grid has paid tiers** | ▲ MIT |
| Cmd-K palette | ○ via `cmdk` (DIY) | ○ DIY | ▲ first-party Spotlight |
| Migration from AntD | ○ moderate effort, low risk; **+Tailwind** | ▲ easiest concept map; heavy bundle | ▲ lowest-friction batteries swap |

**Pros / cons in one line each:**
- **shadcn/ui + Tremor** — *Pro:* most attractive, best RSC/a11y/RTL, you own the source (ideal for a
  forkable, handed-off template), tightens our CSP. *Con:* copy-in (you maintain Table/DatePicker/Form),
  and it **introduces Tailwind**, touching the token policy (`no-raw-hex-color`, `antd-theme.ts`,
  `app/tokens.css`), `docs/design-recipes.md`, the `/design-system` skill, and `scaffold-entity` templates.
- **MUI** — *Pro:* lowest *conceptual* risk (1:1 mental map to AntD), the **best enterprise data grid**, mature
  RTL/a11y. *Con:* heaviest bundle, client-side Emotion (weakest RSC story), advanced grid features are
  **paid** (MUI X Pro/Premium).
- **Mantine** — *Pro:* keeps AntD's batteries-included ergonomics, clear visual upgrade, good SSR, first-party
  Cmd-K. *Con:* smaller enterprise-grid story than MUI; less "trendsetting" than shadcn.

**Recommendation: shadcn/ui + Tremor.** It best satisfies the stated goal (more attractive + enterprise) while
*advancing* the template's own priorities — RSC-native, axe-clean, RTL-first, no vendor lock-in for forks, and
a path to remove the `'unsafe-inline'` CSP compromise. The honest cost is adopting Tailwind and owning more
component code; the migration is bounded (~30 files + the design harness) and phaseable.
**Fallback if "batteries-included" must be preserved:** **MUI** (for the data grid) or **Mantine** (lighter).
*This part stays `Proposed` until the operator picks; the skeleton (Part 2) does not depend on the choice.*

### Part 2 — Standard app skeleton (accepted)

Every fork adopts the canonical IA in `docs/benchmarks/…` §Part B. The non-negotiable spine, validated across
Linear/Stripe/Vercel/Notion/Salesforce/Jira/Datadog/Retool/Shopify/GitHub and 11 starters:

- **Shell:** left grouped sidebar + top bar (global search · **⌘K palette** · Create · notifications bell ·
  help · avatar menu); content area.
- **Home/Dashboard:** "my work" + 3–4 KPI cards + recent activity + quick actions + needs-attention.
- **Work sections:** one sidebar item per entity, each **list → detail → form** (paginated, audited) — the
  `/scaffold-entity` output.
- **Settings split into two trees (never mixed):** **Personal** (Profile · Account & Security · Notifications ·
  Appearance/Language · personal API tokens) reached via the avatar menu; **Organization** (General · Members &
  Roles · Billing · Integrations · API Keys · Security/SSO · Audit Log · Danger Zone) reached via the sidebar.
- **RBAC:** the existing `ADMIN | EDITOR | VIEWER` maps to Owner/Admin · Editor/Member · Viewer; roles managed
  on the **Members page**; **disable/suspend over hard-delete** (already satisfied by soft-delete + audit);
  role-hierarchy-on-invite; hide-vs-disable for unauthorized controls. Custom-role matrix, org switcher, SSO,
  and impersonation are **opt-in enterprise add-ons**, not the baseline.
- **Activity surfaces (kept distinct):** notifications (per-user, top bar) · audit log (org, admin, under
  Security) · per-record timeline (detail view).
- **Errors/empty:** a 401/403/404/500/503 set; instructional empty states with one primary action;
  first-run checklist on Home.

**Gap vs current template** (from the benchmark doc): add the Org-settings tree, a Roles & Permissions page,
⌘K, a notifications inbox, the error-page set, and an enriched dashboard. This template is **already ahead of
the starter field** on enforced RBAC + audit — that stays the differentiator.

## Consequences

### Positive
- Forks inherit a vetted, consistent IA; less per-project structural guesswork.
- Choosing shadcn would modernize the look, improve a11y/RTL, and let us tighten the CSP.
- The skeleton is decided independently, so structure work can start now even before the UI pick lands.

### Negative
- A UI swap is a real migration (component re-skin + design-harness rewire + Tailwind adoption for shadcn).
- New skeleton surfaces (Org settings, ⌘K, notifications, error set) are net new code to build and maintain.

### Mitigations
- **Phase the migration:** shell + `components/shared/*` primitives first, then per-page, `scaffold-entity`
  templates last; each step ships independently behind `/ship`.
- Build skeleton shells UI-agnostically where possible; keep the AntD→new-lib boundary in shared primitives.
- Keep enterprise add-ons (custom roles, org switcher, SSO, impersonation) gated until a real requirement.

## Alternatives considered
1. **Stay on AntD** — zero migration, but does not meet the "more attractive + better a11y/CSP" goal; rejected
   as the primary path (remains the fallback if no swap is approved).
2. **MUI / Mantine** — viable batteries-included swaps; ranked as fallbacks behind shadcn for RSC-fit,
   lock-in, and CSP reasons (see table).
3. **Refine (headless framework)** — overlaps our auth/RBAC/i18n harness but is a large architectural change,
   not a UI swap; rejected for this round.
4. **HeroUI** — most attractive + React-Aria a11y, but v3 is beta (stability risk for a template); revisit
   when stable.
5. **Aceternity/Magic UI** — marketing-animation kits, explicitly not for application UIs; rejected.

## Migration triggers
- Revisit the UI pick if: shadcn's copy-in maintenance burden outweighs its benefits; a fork needs MUI X's
  grid features enough to justify the license; or HeroUI v3 ships stable.
- Revisit the skeleton if multi-tenancy, custom roles, or SSO move from "opt-in" to "default" for the fork base.

## Related
- ADR-001 (template baseline — UI line superseded here), ADR-006 (Vercel/Neon), ADR-013 (`/api/v1` machine
  seam → org API keys), ADR-021 (TanStack Query client layer), ADR-026 (native design system).
- `docs/benchmarks/enterprise-ui-and-app-skeleton.md` — full research, comparison, sitemap, gap analysis.
</content>
