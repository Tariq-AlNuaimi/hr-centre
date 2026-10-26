# ADR-081 — `@dnd-kit/core` for the hiring pipeline board

Status: accepted (operator-authorised dependency for the Hiring port, 2026-10-26) · Blueprint:
`docs/blueprints/hiring-candidates.md`

## Context

Interview Hub's pipeline board lets HR drag a candidate card across the eight-step spine
(Apply … Hire); a drop runs the same stage move — gates included — as the profile's rail. The
port keeps that interaction. HR Centre had no drag-and-drop library: its ticket board (HIVE port)
moves cards with menus.

## Options

1. **`@dnd-kit/core` 6.3.1** (MIT, the library Interview Hub used; ~1 MB unpacked across all
   builds, ~45 KB minified for the core). Pointer, touch AND keyboard sensors with live-region
   announcements built in — keyboard dragging is what makes a board usable without a mouse.
2. **Native HTML5 drag and drop.** No dependency, but no keyboard or touch support and no
   announcements; the board would fail the design rubric's accessibility bar.
3. **No drag — a per-card "Move to" menu only.** Accessible, but drops the interaction the
   operator asked to keep "to the smallest detail".

## Decision

Option 1, core package only (`@dnd-kit/sortable` is not needed — columns are drop zones, not a
sortable list). The board loads it through `next/dynamic`, so only the two board pages pay for
it. Every card ALSO has a "Move to" menu, so dragging is never the only way to move a candidate.

## Consequences

- One runtime dependency (no transitive runtime deps beyond `@dnd-kit/accessibility` and
  `@dnd-kit/utilities`).
- A drop is just a client gesture: the server's stage route decides, so a gated move still
  answers GATE_CONFIRM_REQUIRED and the card snaps back with the reason.
