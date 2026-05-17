---
name: adr
description: Create a new Architecture Decision Record under docs/decisions/ using the template format. Use when the user says "add an ADR", "document this decision", "new ADR for X", "/adr". Mirrors the rihal-ops-portal ADR convention.
---

# /adr — New Architecture Decision Record

Create a new ADR in `docs/decisions/` following the project's numbering and template format.

## Steps

1. **Get the title from the user** (e.g. "Use Redis for the rate limiter"). Title is one short sentence in present tense.
2. **Find the next ADR number.** List files in `docs/decisions/` matching `ADR-???-*.md`. The next number is the highest existing number + 1, zero-padded to 3 digits. If no ADRs exist yet, use 001.
3. **Build the filename:** `ADR-<NNN>-<kebab-title>.md`. Strip punctuation, lowercase, join with hyphens. Example: `ADR-007-use-redis-for-rate-limiter.md`.
4. **Build the file content** by copying `docs/decisions/ADR-TEMPLATE.md` and replacing:
   - `# ADR-NNN — Title` -> `# ADR-<NNN> — <Title>`
   - `**Status:** Proposed` (keep)
   - `**Date:** YYYY-MM-DD` -> today's date (UTC) in ISO format
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
