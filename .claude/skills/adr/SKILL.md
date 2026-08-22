---
name: adr
description: Creates a new Architecture Decision Record under docs/decisions/ documenting why an approach was chosen. Use when the user wants an ADR, to document a decision, or to write up why an architectural choice was made.
---

# /adr — New Architecture Decision Record

Create a new ADR in `docs/decisions/` following the project's numbering and template format.

## Steps

0. **Preflight: the template must exist.** Confirm `docs/decisions/ADR-TEMPLATE.md` is present. If it is missing, **stop and report** — "Can't write an ADR: `docs/decisions/ADR-TEMPLATE.md` is missing. Restore it (e.g. `/sync-from-template`) and re-run `/adr`." — rather than silently inventing a skeleton.
1. **Get the title from the user** (e.g. "Use Redis for the rate limiter"). Title is one short sentence in present tense. If the ADR changes the **ADR-001 locked stack** or relaxes a **hard rule** (CLAUDE.md → "Hard rules" / "Ask before"), route it through review first — write the superseding ADR as `Proposed` and get operator sign-off before it goes `Accepted`.
2. **Find the next ADR number.** List files in `docs/decisions/` matching `ADR-???-*.md`. The next number is the highest existing number + 1, zero-padded to 3 digits. If no ADRs exist yet, use 001.
3. **Build the filename:** `ADR-<NNN>-<kebab-title>.md`. Strip punctuation, lowercase, join with hyphens. Example: `ADR-007-use-redis-for-rate-limiter.md`.
4. **Build the file content** by copying `docs/decisions/ADR-TEMPLATE.md` and replacing:
   - `# ADR-NNN — Title` -> `# ADR-<NNN> — <Title>`
   - `**Status:** Proposed` (keep)
   - `**Date:** YYYY-MM-DD` -> today's date (UTC) in ISO 8601 format `YYYY-MM-DD` (e.g. `2026-06-24`)
   - `**Decision owner:** <name>` -> the current git user (`git config user.name`); fall back to the repo owner if unset
5. **Write the file** to `docs/decisions/ADR-<NNN>-<kebab>.md`.
6. **Report** the new path and prompt the user to fill in Context / Decision / Consequences / Alternatives / Migration triggers / Related.

## Conventions

- Status taxonomy: `Proposed`, `Accepted`, `Deprecated`, `Superseded by ADR-NNN`, `Withdrawn`.
- ADRs are append-only. To change a decision, write a new ADR with status `Accepted` and mark the old one `Superseded by ADR-<new>`.
- Reference ADR numbers (not titles) in CLAUDE.md / SECURITY.md / code comments — titles change, numbers don't.
- Cross-link to related ADRs in the `## Related` section.

## Examples

User: "Add an ADR for using Redis for the rate limiter."
-> Find next number (say 007). Write `docs/decisions/ADR-007-use-redis-for-rate-limiter.md` with the template skeleton, today's date, and the user's name as decision owner.

## Verification

Before calling this done:

- [ ] `docs/decisions/ADR-<NNN>-<kebab-title>.md` exists on disk with `<NNN>` one
      higher than every other `ADR-???-*.md` in `docs/decisions/`
- [ ] `Status`, `Date`, and `Decision owner` are filled in — not the template's
      placeholder text
- [ ] If this ADR changes the ADR-001 locked stack or relaxes a Hard rule, it is
      `Proposed` pending operator sign-off, not `Accepted`
- [ ] If superseding a prior ADR, that ADR's `Status` line is updated to
      `Superseded by ADR-<NNN>`

**Emits:** a committed `docs/decisions/ADR-<NNN>-<kebab-title>.md`.
