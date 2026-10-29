# P2 platform — core catalogues, Employee grade link, platform AI settings (ADR-097)

Scope: lib/core/catalogue/grades.ts, lib/core/ai/settings.ts, lib/hiring/library.ts, lib/hiring/ai/config.ts, lib/hiring/ai/admin.ts, lib/hiring/ai/skills.ts, lib/hiring/panel.ts, lib/hiring/settings.ts, lib/prisma/soft-delete-extension.ts, lib/prisma/recyclable.ts, lib/nav/tabs.ts, app/[locale]/(dashboard)/admin/settings/ai/page.tsx, components/settings/PlatformAiSettings.tsx, components/hiring/settings/SettingsView.tsx, prisma/schema.prisma, prisma/migrations/20261029142759_core_catalogues/**, prisma/seed-hiring.ts, tests/integration/core-catalogues.test.ts

Status: operator-approved P2 roadmap, item 5 (catalogues + AI). Audit: `ux/tickets-hiring.md` P2-4, P2-8.
Feature parity: n/a — consolidation.

## Stories and acceptance criteria

- **US-1 (HR) one grade list.** AC-1.1 Hiring's grades and competencies are the core
  catalogues (same ids, same screens). AC-1.2 Every employee's grade links to a catalogue
  grade; unknown grades were added for that company with no band.
- **US-2 (HR) the link stays right.** AC-2.1 Any write of an employee's grade or company
  re-links it (trigger). AC-2.2 The company's grade beats a group-wide one; case and
  spacing are ignored. AC-2.3 Adding, renaming or removing a catalogue grade re-links the
  people who hold it.
- **US-3 (admin) one AI setup.** AC-3.1 Provider, key, model and limits are platform
  settings at Admin › Settings › AI; the stored key still works after the move. AC-3.2
  Hiring › Settings › AI points there.

## Worst paths

- Catalogue grade soft-deleted → employees fall back to a group-wide match or unlinked.
- A grade string matches nothing → kept as written, unlinked, until the catalogue has it.

## Data

Migration `20261029142759_core_catalogues`. Evidence: scratch replay — 2 hiring grades + 1 competency copied with ids;
5 employees: G6→company G6, "g5 "→group G5, "Senior"/"senior"→one new company grade,
null→unlinked; `ai.apiKey` moved to `platform`, `ai.scoringWeights` stayed `hiring`.
