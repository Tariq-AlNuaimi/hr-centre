# ADR-074 — Adopt the Rihal HR platform look v0.2

**Status:** 🟢 Accepted — operator decision 2026-10-25 (Tariq Al-Naaimi).
**Date:** 2026-10-25
**Related:** HIVE ADR-076 (first adopter); `hr-onboarding/docs/platform/look/look-v0.2.html` (the signed-off look).

## Context

v0.2 is the shared look of every Rihal HR app: calm slate surfaces, one deep-teal accent, and apps told apart by icon and name, never by colour. HIVE adopted it first (ADR-076). This app was still on the template's royal blue `#0165ff`.

## Decision

Adopt v0.2's values. This app already had v0.2's font (Geist), radii (6/8/12) and 4px grid, so the change is tokens only:

- brand teal `#0f766e`, with teal-as-text `#0b5d57` (light) and `#7fddd3` (dark);
- v0.2 slate surfaces and text, light and dark;
- v0.2 status tokens (ok, warn, err, info, neutral) behind the Badge variants, plus a new `info` variant;
- chart series led by a lifted teal (`#12877d`) that clears 3:1 on both themes.

The values are identical to HIVE's.

## Consequences

- **Status meanings are unchanged:** each status keeps the Badge variant it had, and only the colours behind the variants moved.
- **Every pair is measured:** `tests/contracts/platform-palette.test.ts` re-measures every pair in both themes.
- **Not in scope:** the platform shell (app switcher, cross-app My tasks, company filter, monochrome app icons) arrives with the platform roll-out.
