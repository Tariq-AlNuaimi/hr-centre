# Blueprint — Precision design-system pass (chrome · dashboard · auth · fallbacks)

Scope: app/globals.css, app/tokens.css, components/layout/**, components/shared/StatCard.tsx, components/shared/Chart.impl.tsx, components/shared/AuthCard.tsx, components/shared/ai/AiAssistPanel.tsx, components/dashboard/DashboardContent.tsx, app/[locale]/(dashboard)/page.tsx, app/[locale]/(auth)/**, app/not-found.tsx, app/global-error.tsx

Track: **Full** (multi-file, touches the token layer + app chrome + several pages).

> Written retroactively (2026-08-08) after the post-push senior review flagged the missing
> contract (ADR-033). The work already shipped to `main`; this records the design read, stories,
> and scenarios it implemented so future design passes and `/qa`/`/uat` have something to trace
> against instead of re-deriving intent from commit messages.

## Problem & outcome

The template's live app chrome looked dated and heavier than its own `design-system`/`style-guide`
showcase pages — inactive sidebar items and controls rendered as raised native buttons. **Root
cause:** `app/globals.css` never re-imported Tailwind **Preflight** after AntD was removed (the
ADR-029 "C4" step was left undone), so native form-control styling leaked app-wide. Outcome: a
cohesive, adoptable **Precision** design language (flat, hairline, dense — the operator's pick from
three mockups), applied token-first so forks inherit it and rebrand from one config.

## User stories

- **US1 — Operator/fork owner:** as someone forking the template, I want the shipped app to already
  look like the polished showcase, so I don't have to fix chrome before sharing it.
- **US2 — End user:** as a user of a fork, I want a calm, legible dashboard and clear auth screens
  in light **and** dark, so the tool feels trustworthy.
- **US3 — Fork rebrander:** as someone rebranding, I want one `brand.config.ts` edit to retint the
  whole app (including the new active-nav tint), so white-labelling stays a one-liner.
- **US4 — Maintainer:** as a maintainer, I want the three auth pages to share one card primitive, so
  a change lands once, not three times.

## Design read

Surface: internal operational tool · audience: operator + their team + IT at handoff · tone: calm,
restrained, "the accent points, it doesn't decorate" · density: comfortable→compact. One royal
accent; one primary action per screen; flat surfaces on a faint cool ground; hairline borders;
minimal elevation. Dark is the single `[data-theme="dark"]` swap; RTL via logical utilities.

## Happy / worst-path scenarios

- **Happy — dashboard:** admin loads `/`; sees flat KPI cards on the cool ground, a donut of
  users-by-role, an honest new-user sparkline (real 14-day series), and the recent-activity table.
- **Happy — auth:** user opens `/login`; split brand panel + a card via the shared `AuthCard`; the
  "Forgot password?" link is a clearly visible royal link (WCAG 1.4.1).
- **Worst — empty/seed data:** a fresh fork with one admin shows honest near-empty states — a
  near-flat sparkline, "No data found" tables — never fabricated demo numbers.
- **Worst — dark + fallback:** a runtime error hits `global-error.tsx` / a bad URL hits
  `not-found.tsx`; both render on-brand (monogram + primary action) even though they're
  token-isolated (own `<html>`, no providers, inline `rgb()` styles).
- **Worst — RTL:** with `ar` enabled the sidebar, header, cards, and the AI panel accent stripe
  mirror correctly (logical `border-s`/`ms`/`ps`), no physical `left/right` leakage.

## Architecture

- **Token layer (single source):** `app/globals.css` imports Preflight (C4); `app/tokens.css` adds a
  cool page ground (`--background` ≠ `--card`), a cooler hairline, and `--accent-subtle`
  (`color-mix(brand 12%, card)` — one def, both themes, tracks rebrand) + its `--color-accent-subtle`
  utility. No raw hex in components (ADR-015).
- **Chrome:** `AppSidebar` active = `bg-accent-subtle` + `text-nav-active-foreground`; `AppHeader`
  hairline (no shadow).
- **Primitives:** `Chart.impl` pie→donut; `StatCard` gains an optional on-token sparkline;
  `AiAssistPanel` stripe → logical `border-s`. New `AuthCard` (ledgered, ADR-032) de-dupes the three
  auth pages.
- **Dashboard data:** `(dashboard)/page.tsx` RSC computes a real 14-day new-user series (14 bounded
  `prisma.user.count` UTC-day buckets, `Promise.all`, in the existing `unstable_cache`).
- **Fallbacks:** `not-found.tsx` / `global-error.tsx` restyled inline (context-free; `brand.config`
  is pure data, safe for the `/_not-found` prerender).

## Open questions

- [x] Which of the three mockups? → **Precision** (operator, 2026-08-08).
- [x] Ship the before/after screenshots on `main`? → **No** — operator chose lean, code-only `main`;
      captures live on branch `claude/template-default-designs-qukvj6` + the published galleries.
- [x] Sparkline trend badge on Total-users? → **No** — a signups delta misreads as a totals change;
      sparkline only (the `StatCard` `trend` prop stays for forks with a same-metric trend).

Confirmed: Tariq Al-Naaimi 2026-08-08 (retroactive; Precision direction + full-sweep scope approved
in-session; documents already-shipped work per ADR-033).
