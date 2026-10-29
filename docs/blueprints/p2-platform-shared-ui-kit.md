# P2 platform — Hiring's private form kit promoted to shared components

Scope: components/shared/FormControls.tsx, components/shared/UrlTabs.tsx, components/hiring/**, components/jml/**, components/settings/**, components/approvals/**

Status: operator-approved P2 roadmap, item 6 (Hiring UI kit). Audit: `ux/tickets-hiring.md` P2-9.
Feature parity: n/a — code organisation.

## Stories and acceptance criteria

- **US-1 (developer) one form kit.** AC-1.1 `Field` / `Textarea` / `Check` live in
  `components/shared/FormControls.tsx`; Hiring and JML import them from there and JML's
  duplicate `Field` is gone (`id` is accepted as an alias of `htmlFor`). AC-1.2 The URL-synced
  `Tabs` live in `components/shared/UrlTabs.tsx`. AC-1.3 No behaviour change: same markup
  and props (JML fields gain the shared 6px label gap and the optional error/required).

## Not moved, and why

- `components/hiring/ui/states.tsx` (`QueryState`, `Notice`) reads Hiring's API error type;
  `person-picker.tsx` searches Hiring's directory (`/api/hiring/directory`, hiring-scoped
  permissions). Promoting them needs a core people-search endpoint with its own access rule
  — a follow-up, not a move.
- `badges.tsx` maps Hiring statuses to tones — module vocabulary, correctly module-owned.
