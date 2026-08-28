# Blueprint — in-app notifications, so §5.5's ladder reaches people without SMTP

**Status:** approved to build (operator, 2026-08-28 — "Build an in-app fallback").
**Scope:** `lib/pms/notifications.ts`, `lib/pms/cycle-notify.ts`, `lib/validations/notification.ts`,
`app/api/notifications/**`, `app/api/internal/cycle-sweep/**`, `components/layout/NotificationsMenu.tsx`,
`components/pms/NotificationList.tsx`, `components/pms/MyTasksOversight.tsx`, `hooks/use-notifications.ts`,
`prisma/schema.prisma`,
`prisma/migrations/20260828100000_pms_in_app_notifications/**`, `messages/*.json`, `tests/contracts/pms-notifications.test.ts`,
`tests/integration/pms-notifications.test.ts`.
**Spec clauses:** §5.5 (escalation ladder), §5.6 (compliance record), §9.7 (360 reminders),
§4.4 (My Tasks / Oversight).

## The problem, stated exactly

`lib/pms/cycle-notify.ts:116` is one line:

```ts
if (!isEmailEnabled()) return { attempted: 0, sent: 0, skipped: true };
```

`isEmailEnabled()` is false on this deployment and will stay false until IT sets `SMTP_HOST`
(see `docs/verification/CHASE-NOTES.md`). So today the daily sweep writes §5.6's compliance
record faithfully and then **tells nobody**. §5.5's ladder — the part of the spec whose whole
purpose is that a missed deadline reaches a human — is inert.

That is not a bug in the sweep. It is a single-channel design: the spec assumes email exists,
and the deployment does not have it. The fix is a **second channel that cannot be switched off**,
with email demoted from dependency to enhancement.

## Who is actually unreachable today

Worth being precise, because two of the five audiences are already served and pretending
otherwise would overstate the change.

| Audience                                  | Event                  | Reached today?                                       |
| ----------------------------------------- | ---------------------- | ---------------------------------------------------- |
| Manager, deadline approaching             | `REMINDER_SENT`        | **Partly** — My Tasks shows the row with a due badge |
| Manager, deadline missed                  | `DEADLINE_MISSED`      | **Partly** — same row, `overdue` badge               |
| **Skip-level manager**                    | `ESCALATED_SKIP_LEVEL` | **No.** Not their report; no task row exists         |
| **HR (escalations + intervention queue)** | `ESCALATED_HR`         | **No.** Only in the sweep's JSON response            |
| 360 rater                                 | §9.7 reminder          | **Yes** — `buildThreeSixtyTasks` already lists it    |

So the genuine holes are the two escalation rungs that exist precisely to reach someone who is
_not_ the person with the task. §5.5 calls the skip-level the one "with authority to compel
action"; right now they are told nothing, ever. That is the whole point of the rung.

The rest still belongs in the feed — "what was I told, and when" is a different question from
"what is waiting on me", and a manager who was reminded should be able to see that they were.

## Stories

1. **As a skip-level manager**, when a manager below me misses a goal-setting deadline, I see it
   in the app the next morning without anyone emailing me, so I can compel the action §5.5 says
   I have the authority to compel.
2. **As HR**, I see the escalations and the past-grace intervention queue in the app, so §5.5's
   third rung is something I can act on rather than something buried in a cron response body.
3. **As a manager**, I can see the reminders and misses recorded against my sets, so the
   compliance record §11.2 will later show is not a surprise.
4. **As any user**, a badge on the header bell tells me there is something new from any page,
   so the feed does not depend on me visiting the dashboard.
5. **As a user with no employee record** (a platform admin, ADR-065), I see nothing and no badge,
   because nothing in the PMS is assigned to me.

## Happy path

Sweep runs 06:00 → writes compliance rows (unchanged) → computes the recipient map it already
computes (`linesByRecipient`) → **persists one `Notification` per recipient line** → _then_
attempts email if configured. Skip-level manager signs in, bell shows **1**, popover names the
manager and the miss, clicking it opens the goal-setting screen and marks it read.

## Worst paths, and what each must do

| Worst path                                        | Required behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notification write throws                         | The compliance row is already committed and must never be lost. Persist inside the existing try/catch, after the rows.                                                                                                                                                                                                                                                                                                                                                                                  |
| Sweep runs again tomorrow, same unresolved miss   | **No second notification.** Dedupe on the event's own identity, same key `ComplianceEvent` uses, plus the recipient.                                                                                                                                                                                                                                                                                                                                                                                    |
| HR extends the deadline (§5.5's own remedy)       | A _new_ notification, because it is a new miss against a new deadline. Falls out of including `measuredAgainstDeadline` in the key.                                                                                                                                                                                                                                                                                                                                                                     |
| SMTP is configured later                          | Both channels fire. Email is additive; the feed does not change behaviour.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A backlog of 5,000 participants escalates at once | Bounded by TWO different caps, and conflating them was a real defect caught in review: `MAX_NOTIFICATIONS` (200) bounds RECIPIENTS for email, while `MAX_PERSISTED_NOTIFICATIONS` (1,000) bounds ROWS written per run — one recipient can warrant several rows. The row budget is spent only on notifications nobody has received yet, so a backlog drains across runs instead of stalling behind its own first thousand.                                                                               |
| Recipient has no employee record                  | Cannot happen — the ladder works in employee ids — but the read side keys on `actor.employeeId` and returns empty for a null one.                                                                                                                                                                                                                                                                                                                                                                       |
| A user reads someone else's notifications         | The route filters on the session's own `employeeId`. There is no id-taking read endpoint.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Employee is soft-deleted                          | Their notifications SURVIVE. `Employee` is a soft-delete model, so `prisma.employee.delete` is rewritten to an UPDATE and the FK cascade never fires — found by running it, not by reading the schema. That is the right outcome (the recycling bin restores the person and their history together) and it is safe because §12.1's off-boarding revokes the login, so a soft-deleted person cannot sign in to read the feed. Both halves are asserted in `tests/integration/pms-notifications.test.ts`. |

## Architecture

### Data — one new model, additive

```prisma
model Notification {
  id                  String           @id @default(cuid())
  recipientEmployeeId String           @map("recipient_employee_id")
  recipientEmployee   Employee         @relation("NotificationRecipient", fields: [...], references: [id], onDelete: Cascade)
  kind                NotificationKind
  body                String
  href                String?
  dedupeKey           String           @unique @map("dedupe_key")
  readAt              DateTime?        @map("read_at")
  createdAt           DateTime         @default(now()) @map("created_at")

  @@index([recipientEmployeeId, readAt])
  @@index([recipientEmployeeId, createdAt])
  @@map("notifications")
}
```

**There is no `title` column, deliberately.** The heading a reader scans comes from `kind` and is
translated by next-intl in both locales; `body` holds the machine's own English sentence — the same
one §5.6 already stores on `ComplianceEvent.detail` and §11.2 already shows HR. A stored title would
be a second, untranslated copy of the ladder's prose with nothing keeping it true.

`dedupeKey` is the whole idempotency story, and it is the same trick `ComplianceEvent` uses:
a unique index, a `create` that catches `P2002`, and no bookkeeping anywhere else. For a ladder
event the key is
`cev:<cycleId>:<stageKind>:<subjectEmployeeId>:<kind>:<deadlineISO>:<recipientId>` — the
compliance event's own unique tuple with the recipient appended, so the notification's identity
is exactly the event's identity fanned out. For a 360 reminder it is
`t360:<assignmentId>:<deadlineISO>`.

**Not** added to the audit `EXCLUDE` set (that needs an ADR, and would be the wrong call anyway).
Volume is bounded by _real escalations_, not by sweep cadence: the daily re-run writes nothing
new because every key already exists. A cycle's worth of escalations is a few hundred audit rows
once, not 200 a day.

**Not** soft-deleted. A notification is a fact about something that happened; there is nothing to
restore and no recycling-bin story.

### Write path — `lib/pms/cycle-notify.ts`

The one structural change: `notify()` and `remindThreeSixtyRaters()` stop returning early when
email is off. They build the recipient map (unchanged), **persist**, then send only if
`isEmailEnabled()`. Because both already funnel through `deliver()`, persistence goes there —
one place, both channels, and they cannot drift apart. `deliver()`'s return type grows a
`persisted` count; the sweep's response reports it.

### Read path

- `GET /api/notifications` — `withRateLimit(withAuth(…))`, zod-parsed query, returns
  `{ items, unread }`. Bounded at 20 rows, newest first, scoped to `actor.employeeId`.
- `POST /api/notifications/read` — body `{ ids: string[] } | { all: true }`, zod `strictObject`.
  The `all` branch is an `updateMany` scoped to the viewer, which trips
  `no-unaudited-bulk-write`; it takes the sanctioned escape hatch — an explicit `recordAudit()`
  for the batch plus a single-line disable — rather than looping N updates for a click.

### UI

- `components/layout/NotificationsMenu.tsx` already ships the finished chrome with a `count = 0`
  seam and an honest empty state. Wire it: TanStack Query for the feed, badge from `unread`,
  rows link and mark-read on click, "Mark all read" in the header of the popover.
- `components/pms/NotificationList.tsx` — the row list, shared so the popover and the dashboard
  render the same thing.
- `components/pms/MyTasksOversight.tsx` — unread notifications above the task list in the §4.4
  My Tasks card, capped at five, so the dashboard shows them without a second trip.

The distinction the UI must keep honest: **tasks are what is waiting on you; notifications are
what you were told.** They are different lists and are labelled as such.

## Open questions

1. **Retention.** Nothing purges notifications. The audit-purge cron has a retention window;
   this does not. Left deliberately: a first cycle's volume is small, and choosing a window
   before anyone has used the feed would be guessing. Flagged in the handoff.
2. **Read state is per-employee, not per-device.** Marking read on a laptop clears the phone.
   Correct for this system; noted so it is not later read as a bug.
3. **No preferences.** There is no "mute" or per-kind opt-out. §5.5 escalations are not
   optional by design — the ladder exists to be unavoidable.

## Two things the browser found that a code read did not

Both were caught by signing in as a real manager against a real database, not by reviewing the
diff.

1. **`hover:bg-accent` painted the row solid brand blue and left the text at `#111827`.** `--accent`
   is `--brand-accent` — a colour for TEXT, not a surface — so the hover state was dark-on-royal.
   Measured as `rgb(1,101,255)` under `rgb(17,24,39)` in the page, then changed to `bg-muted`, which
   is what every other hoverable row in the app already used.
2. **A feed row is not a task row.** Rendering the notices inside `MyTasksBody` would have hidden
   them behind its empty/loading/error states — and "no performance cycle is open" is exactly the
   morning an escalation matters. The block sits outside it.

Axe (wcag2a/2aa/21a/21aa) is clean on the dashboard and on the open popover, in both themes; no
horizontal overflow at 375px.

## What the post-push breadth review changed

One finding was worth more than the fix it asked for, so it is recorded here rather than only in a
commit message.

**The feed must not be gated on `isNew`.** The sweep commits every compliance row _before_ it
notifies, and it runs under Vercel's 60-second ceiling — which this change is what makes non-trivial,
since `notify()` used to be an `O(1)` early return on this deployment. A run killed in between left
the rows written; the next morning the ladder re-derived the same events, they came back
`isNew: false`, and — while the feed was gated on that flag — the skip-level manager this feature
exists to reach would never be told. Permanently, silently, with no retry path.

The fix is not a bigger time budget (60s is the plan's ceiling). It is that **`isNew` is the wrong
question for a durable channel.** `isNew` lives in memory and survives one run; "has this person
been told" lives in the `dedupeKey` unique index and survives the process. So the in-app fan-out now
takes every written event and `persistNotifications` asks the index which of them are new — one
indexed read per 500 candidates, then writes only the gap. Email keeps the `isNew` gate, which is
what it was always for: not re-mailing HR the same miss daily.

Three properties fall out of that, and each has a test:

- An interrupted run is **self-healing** — tomorrow writes exactly what yesterday missed.
- A quiet morning costs **reads, not writes**: every already-told row is filtered out before the
  budget is touched, instead of being a `create` that collides.
- The row budget bounds **writes rather than candidates**, so a backlog advances each run instead of
  re-deriving the same unreachable first thousand forever.

Mutation-tested: re-applying the `isNew` gate to the feed turns two of the ten integration tests red.
