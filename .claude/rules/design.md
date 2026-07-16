---
globs: components/**, app/**/*.tsx, app/**/*.css, messages/**
title: UI — Definition of Done, design system, i18n/RTL
---

# UI rules (Definition of Done)

Loaded when you touch `components/**`, `app/**/*.tsx`, styles, or `messages/**`. Full rubric:
`docs/uat-rubric.md`. Copy-paste design patterns: `docs/design-recipes.md` (page header, table,
form, filter bar, modal, state triad, a11y) + the slop gate — driven by `/design-system`.

## Build it right the first time with `/design-system`

Proactive: declare the design read, build from `docs/design-recipes.md`'s vetted patterns on the
shipped `components/shared/*` primitives — don't improvise UI and fix it at QA. Declare the design
read first (surface/audience/tone/density); one accent, one primary action per screen, no nested
Cards, no emoji-as-icons. Real empty/loading/error states; on-token spacing/colors/type; zod-backed
validation messages at the boundary; no dead controls; honest feedback (no green toast over a
failure); responsive + RTL (`ar`) + dark hold; axe clean of serious/critical. QA runs in gated
tiers: `/design-qa` → `/ship` + risk-based cases → `/uat`, orchestrated by `/qa`; a red gate stops
the line. The operator signs off UAT.

- **Tokens only** — `no-raw-hex-color` rule: colors/tokens come from `app/tokens.css` /
  `brand.config.ts` / `chart-palette.ts` (ADR-015). No raw hex in components.

## Known traps (don't "fix")

- Locales are config-driven (`project.config.json` `locales`/`defaultLocale` → `i18n/config.ts`):
  add/remove a locale there and the routing, the `<html dir>` direction
  (`localeDirection`/`directionForLocale`), the shared locale-prefix regex (`localePrefixRegex`,
  imported by middleware + chrome), and the switcher visibility all follow — no hand-edited
  `(en|ar)` regex anymore. RTL is automatic for `ar`/`he`/`fa`/`ur`. Default ships English-only;
  `messages/ar.json` + RTL code stay inert until a fork sets `"locales": ["en","ar"]`.
- CSP allows `'unsafe-inline'` script+style (AntD SSR + Next bootstrap). Vercel auto-injects
  `AUTH_URL`; don't set it manually unless wiring a custom domain first.
- The root `app/not-found.tsx` is deliberately context-free (no providers): Next 16 prerenders
  `/_not-found` outside `[locale]`. If a fork's build dies in `/_global-error` or `/_not-found`
  with a `useContext` TypeError, that's upstream Next regression #85668/#86178 — fix with a
  context-free root file, never by editing the locale providers. Pinned next@16.2.9 builds clean.
