# Blueprint — Sign-in limits, access-filtered notices, real HTTP status codes

Scope: lib/nav/page-gate.ts, lib/nav/record-gate.ts, lib/nav/server-context.ts, lib/jml/reports/registry.ts, lib/jml/reports/leave/registry.ts, app/[locale]/(dashboard)/**, tests/contracts/page-status.test.ts, lib/core/notify/audience.ts, lib/core/notify/store.ts, lib/hive/services/ticket-notify.ts, lib/hive/services/permissions.ts, lib/jml/access.ts, lib/hiring/work-items.ts, lib/jml/work-items.ts, tests/contracts/notice-access.test.ts, tests/integration/notice-access.test.ts, lib/rate-limit.ts, app/api/auth/**, app/api/logins/change-password/route.ts, app/api/users/[id]/password/route.ts, tests/contracts/auth-rate-limits.test.ts, docs/decisions/ADR-100-sign-in-and-password-rate-limits.md, SECURITY.md

Operator-approved hardening batch (2026-10-29). Three slices, each its own PR.

## Slice 1 — Login and password rate limits (ADR-100)

**Story.** As an employee signing in from the office (one NAT address shared by everyone),
I am not throttled because colleagues are signing in too; as the owner of an account, an
attacker cannot make more than a handful of guesses or reset emails against it per window,
whatever IPs they rotate through.

**ACs**

- AC-L1.1 `POST /api/auth/*`: 120/min per IP; a credentials sign-in also spends a
  10/min bucket keyed on the normalised (trimmed, lower-cased) email. 11th attempt on one
  account → 429 with `Retry-After`, and never reaches Auth.js.
- AC-L1.2 Password change (`PUT /api/users/[id]/password`, `POST /api/logins/change-password`):
  5/min per signed-in user (one bucket shared by both routes), 60/min per IP outside the
  auth wrapper.
- AC-L1.3 Forgot password: 3 per 15 min per address, 30/min per IP. Response stays neutral
  (no enumeration): the 429 depends only on request volume.
- AC-L1.4 Reset password: 30/min per IP; 3 per 15 min per account once a valid token names it.
- AC-L1.5 `lib/auth.ts` failed-login lockout unchanged.
- AC-L1.6 ADR + SECURITY.md record the numbers and that the in-memory limiter is
  per-instance (approximate across Vercel instances; Valkey / Upstash is the shared path).

**Happy path.** 40 people sign in at 09:00 from one office IP → all pass (≤120/min).
**Worst path.** Credential stuffing against one mailbox from rotating IPs → the account
bucket refuses the 11th try in the minute, and the lockout trips after 5 bad passwords.
Forgot-password spam to one mailbox → 3 emails per 15 min at most.

## Slice 2 — Notice recipients filtered by access

**Story.** As a hiring manager scoped to Rihal, I am never told about a Transformation
Pioneers requisition — in the bell, in My work, or by email — because I could not open it.

**Design.** A notice is about the record its link opens, so the rule is "only people who can
open that link". `lib/core/notify/audience.ts` maps each module link to the SAME loader the
record's read route uses (`loadRequisition`, `loadOffer`, `loadMyInterview`, `ticketReach` via
`ticketReaderIds`, JML `caseViewerIds` = `loadCaseFor`'s visibility). The core writer
(`persistNotifications`, which `notifyUsers` and `notifyJml` both use) drops every recipient the
rule refuses; the ticket email path asks the same question before addressing anyone. My work
providers already query in scope; two that did not match their link's rule are fixed (hiring
scorecards, JML approvals to record).

**ACs**

- AC-L2.1 Hiring: a requisition / offer / scorecard notice reaches only users who can open it
  (in-scope `hiring.view`; offers also approvers in scope; scorecards panelists in scope).
  Approval-role holders and delegates without access are dropped.
- AC-L2.2 JML: a case notice reaches only users with `jml.view` over the case (or the placement a
  mover is moving into). `/jml/my-tasks` notices pass (the inbox lists only the viewer's tasks).
- AC-L2.3 Tickets: bell and email reach only users who can read the ticket (See tickets, or
  Draft/Approve on its pair).
- AC-L2.4 A link under `/hiring`, `/tickets`, `/jml`, `/approvals` with no rule is refused (fail
  closed); a contract test pins that every emitter's link has a rule. Other modules' links
  (Performance) pass unchanged.
- AC-L2.5 My work: hiring scorecards only for panelists who still read the requisition; JML
  approvals only on cases the viewer can open.

**Worst paths.** Access check throws → that link's recipients are refused (fail closed), warned
without detail; the business action has already committed. Recipient logins unreadable → gated
notices held back (the sweep retries); preferences unreadable → fail open (unchanged).

## Slice 3 — Real HTTP status codes (ADR-101)

**Story.** As anyone (a person, a crawler, an uptime monitor), when I open a screen I may not
use or a record that does not exist for me, the response is a real 404, not a 200 that draws
"You do not have access" or "Not found".

**Inventory (found by the sweep, `tests/contracts/page-status.test.ts`).**

- Client refusals, section-gated on the server (`SECTION_GATES`):
  - admin: access, cycles, edge cases, import, imports, org setup, strategy scores, AI settings;
  - audit log, recycling bin, calibration, executive, reports, the 360 console, goal setting;
  - hiring: home, insights, library, settings;
  - every JML screen: home, cases, joiners (+ new / edit), movers (+ new), leavers (+ new /
    calendar), calendar, statutory, my tasks, reports, settings (hub + 18 screens).
- Detail screens, record-gated by the module loader:
  - hiring: requisition (+ 9 sub-screens), candidate (+ preboarding), offer, interview,
    evaluation, panel (brief / score / compare);
  - JML: case, joiner, report and leaver report slugs;
  - ticket, performance cycle, 360 assignment (rater only), access login.
- Server `notFound()` that sat under a loading boundary, fixed by moving the boundary down:
  - the admin settings hub and its email-templates and performance pages;
  - the tickets new-ticket screen and setup hub (the hub's empty "no access" state is now a 404);
  - the hiring library kind; `team/hiring`; `people/new`;
  - goal-setting, mid-year and year-end participants;
  - the legacy `users/*` and `settings` redirects (now real 307s).

**ACs**

- AC-L3.1 Each of the screens above answers 404 to a viewer its own condition refuses, and 200 to
  one it admits (the gate is the screen's own condition, not a stricter one).
- AC-L3.2 Detail screens answer 404 for a missing or out-of-scope record.
- AC-L3.3 The sweep fails on a gate under a loading boundary, an ungated refusal, or an ungated
  detail page.

**Worst paths.** A gate's loader throws → 404 (fail closed). Permissions change mid-session →
the next navigation is re-decided on the server.
