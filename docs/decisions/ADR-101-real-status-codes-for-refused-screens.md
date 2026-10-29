# ADR-101 — Refused and missing screens answer a real 404, decided before streaming

**Status:** Accepted — operator-approved hardening batch (2026-10-29)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

QA2 N-17 fixed `/admin/roles`, `/tickets` and the person page, but some 60 other screens
still drew "You do not have access" or "Not found" inside an HTTP 200. There were two
causes:

1. **Client-side refusals.** Most screens are client components that fetch, get a 403 or
   404, and render a refusal. Once the HTML has been sent, the status cannot change.
2. **Server `notFound()` inside a `loading.tsx` boundary.** The segment's Suspense
   boundary streams the 200 before the page runs, so a `notFound()` there renders the
   not-found UI under a 200 (`hiring/`, `jml/`, `tickets/`, `admin/settings/`, the
   participant pages under `goal-setting/`, `mid-year/` and `year-end/`, `team/hiring`,
   `people/new`).

## Decision

- **Section gates** (`lib/nav/page-gate.ts`, `SECTION_GATES`): each screen's OWN refusal
  condition, evaluated on the server over the sidebar's `NavContext`, in the page itself
  or in a layout outside every loading boundary. A refusal is `notFound()`, which is 404.
- **Record gates** (`lib/nav/record-gate.ts`): each detail screen calls the loader its
  read route uses (`loadRequisition`, `loadOffer`, `loadCaseFor`, the ticket reach, …), so
  a missing or out-of-scope record is a 404.
- **404 rather than 403.** This matches the API's "out of scope is not found" rule (no
  existence oracle) and the pattern already used for `/admin/roles` and `/tickets`.
  `forbidden()` needs the experimental `authInterrupts` flag, which is not worth enabling
  for a status the API deliberately does not give.
- **Loading boundaries moved down.** Where a boundary wrapped a gated descendant, it was
  removed (`hiring/`, `jml/`, `tickets/`, `admin/settings/`, `users/`, `people/new/`) or
  moved into a route group with its list page (`(list)`, `(roster)`, `(home)`,
  `(people)`, `(console)`), the same move the person page made (D-16). The client screens
  still show their own skeletons while their data loads. Only the instant skeleton while
  the gate's server round-trip runs is lost, on the screens whose boundary went.
- **A sweep keeps it that way.** `tests/contracts/page-status.test.ts` walks every
  dashboard page and fails when:
  - a gate sits under a loading boundary;
  - a page whose component tree draws a refusal has no section gate in front of it;
  - a `[param]` page has no record gate.

## Consequences

- The client components keep their refusal branches as defence in depth, and for the
  moment while permissions load. The server now answers before they render.
- A new screen with a refusal must add a `SECTION_GATES` entry and a gate call, or the
  sweep goes red.
