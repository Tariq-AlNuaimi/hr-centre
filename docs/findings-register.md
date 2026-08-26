# Findings register (wave-offs must be logged, never silent)

Every time a finding is **not fixed** — deferred, accepted as a known limitation,
declared an intentional trade-off, a "judgment call" handed to the operator, a
skipped QA phase, or a lint/rule suppression — it gets a dated line here. The
point is that "acceptable" is a recorded, reviewable decision, not a silent
shrug (complaint #12). `/qa` refuses to green a release while a wave-off touching
the changed surface is still **open** (un-adjudicated).

- **Security** suppressions (gitleaks / Semgrep / npm-audit / an ESLint security
  rule) go in **SECURITY.md §12**, not here — this register is for the rest
  (the four non-security pillars, UX/design judgment calls, skipped QA phases,
  deferred functionality).
- One line per wave-off. Newest at the top.
- Format: `YYYY-MM-DD — [pillar/area] <finding> — WHY waived — <owner/operator> — status: open | adjudicated(<date>) | fixed(<commit>)`
- A wave-off is **open** until the operator adjudicates it (accepts or schedules
  it) or it's fixed. Don't mark something adjudicated on the operator's behalf.
- **`fixed(<commit>)` must name a RESOLVABLE commit** — a real 7+ hex SHA that
  `git show` can find on the branch's history. Do NOT close with `fixed(this commit)`,
  `fixed(this branch)`, or `fixed(repo-audit)`: those become unverifiable the moment
  the register is read from any later commit (V2 challenge-audit D7). If the change is
  landing in the same commit as this line, close it in a follow-up amend/commit with the
  real SHA, or point at a durable tree artifact (a file/test path) instead. A pre-`main`
  squash can still orphan a SHA — when that happens, replace it with a tree-evidence
  pointer, don't leave a dead hash. (Historical `this commit`/`repo-audit` tokens below
  are NOT back-filled — this convention binds new entries.)

> **Resolved history lives in [`docs/archive/findings-register-2026.md`](archive/findings-register-2026.md)**
> (archived 2026-08-17). This file carries only entries that are still unresolved or conditionally
> re-openable, plus the standing trade-offs below. Nothing was deleted — 40 resolved entries
> (`status: fixed(...)` / `status: adjudicated(...)` with no pending work) moved to the archive so
> the live register stays readable. `/ship`'s `wave-offs` gate parses THIS file only.

## Register

<!-- newest first -->

- 2026-08-26 — [maintainable/observability] **Five explicit `recordAudit()` callers passed
  asymmetric snapshots, so the fields they wrote never reached `changes`.** `changesOverSharedKeys`
  diffs only keys BOTH snapshots carry — deliberately, because diffing the union would report every
  key one side happens to lack as a change from `undefined`. Its own doc named the residual cost and
  said fixing it "means making each caller's two snapshots symmetric, which is a change to those
  routes". Five routes were paying it: `POST /api/kpi-change-requests/[id]/decide` on both branches
  (§6.2's decider and decision reason lived only in `after`), `.../withdraw`,
  `POST /api/publish` (§13.2's "reversal is audited — who, when, **why**", and the why was
  `after`-only), and `POST /api/projects`.

  Two were worse than under-reporting. `withdraw` named `withdrawnByEmployeeId` in `after`; **there
  is no such column on `KpiChangeRequest`** and the update never wrote one, so the audit row asserted
  a fact the record could not hold — who withdrew was already on the audit row's own
  `userId`/`actorEmail`, which is where §12.2 looks. `POST /api/projects` recorded `memberCount`, so
  a §9.6 membership replace that swapped one person for another left the count identical and diffed
  to **nothing** — the write that route exists for was invisible. It now records the sorted member
  ids on both sides.

  **Fixed 2026-08-26.** Each pair carries the same keys, with `null` on the `before` where the row
  genuinely held nothing. One deliberate exception remains and says so at the call site:
  `POST /api/three-sixty/assignments` keeps a one-sided `reason` annotation on a bulk delete —
  it is not a column and did not move, and a symmetric `reason: null` would manufacture a change
  entry reading "the reason changed from nothing". `changesOverSharedKeys` is now a backstop against
  a future forgetful caller rather than a working compromise. Pinned by integration assertions at
  each call site (`pms-change-request`, `pms-three-sixty`, `pms-scoring-chain`) — verified to fail
  against the pre-fix code, not merely to pass against the new. — operator — status: fixed(2026-08-26)

- 2026-08-26 — [maintainable/observability] **An audit row written from inside an interactive
  `$transaction` records the PRE-update values.** The audit extension's re-read and
  `auditLog.create` run on the outer client captured in `defineExtension`, not on the transaction's
  `tx`, so within a transaction they see the row as it was before the write: the audit entry exists
  (the ADR-010 requirement holds) but its `after` is stale and `changes` is null. Repo-wide — the
  new `PATCH /api/three-sixty` plus roughly a dozen existing `$transaction` routes. Found by the
  pre-push review on the F10 change; the operator authorised the `lib/prisma/**` fix on 2026-08-26.
  **Fixed**: the re-read stays (it is authoritative outside a transaction and holds each column's
  real type), and `projectUpdate`/`overlayUnobserved` overlay the write's own `data` on top for the
  keys where the re-read still shows the pre-write value — the signature of the in-transaction case.
  Neither half alone is sufficient, which three review rounds established the hard way. Proved on the running app: four `Assignment` UPDATEs written by
  `POST /api/three-sixty/responses` (a `$transaction` route) carry `changes: null`; the same route,
  same action, after the fix records `status NOT_STARTED → SUBMITTED` and `submittedAt`
  (`docs/verification/pms-360-report/README.md` §6). **Residual**: `auditLog.create` still runs on
  the extension's captured client, so an audit row survives a rolled-back transaction — a false
  positive rather than a blind spot. A Prisma query extension has no access to the `tx` handle, so
  closing that needs a different mechanism; `PATCH /api/three-sixty` avoids it by using a
  conditional `updateMany` with an explicit `recordAudit()` instead of a transaction. — operator —
  status: fixed(see `projectUpdate` in
  `lib/prisma/audit-extension.ts` and its contract tests in `tests/contracts/audit-scrub.test.ts`)

- 2026-08-26 — [high-quality/privacy] **§13.1 — a written 360 comment can be attributable when HR
  authors a distinct open-ended question per template.** Comments come only from unscored questions,
  and each question belongs to exactly one template, i.e. one rating direction. A lone comment under
  a `LINE_MANAGER_TO_EMPLOYEE` heading is therefore provably the ratee's single line manager, under
  a banner saying the comments carry no rater identity. **Fixed 2026-08-26** at the route, not only
  in the UI: `GET /api/three-sixty/results` now sends `question: null` for any comment that stands
  alone under its question, so no consumer can reintroduce the join by rendering a field it was
  handed. Where two or more people answered the same question the label survives, because §9.8 asks
  for comments to be consolidated and a heap of unlabelled sentences is not that. — operator —
  status: fixed(see `unattributableComments` in `app/api/three-sixty/results/route.ts` and the
  contract test in `tests/contracts/pms-three-sixty.test.ts`)

- 2026-08-26 — [high-quality/correctness] **The 360 window was write-once: a mistyped `opensAt` or
  `deadline` could never be corrected.** `POST /api/three-sixty` was its only writer, there was no
  `PATCH` and no `DELETE`, and §9.1 allows one 360 per performance year — so a slip mis-set the whole
  year's 360 window with no path back, and §5.4 makes the deadline a hard lock. Found while
  verifying §9.8's report by driving the product rather than reading it (red-team F10). — operator —
  status: fixed(see `docs/verification/pms-360-report/README.md` §2 and `app/api/three-sixty/route.ts` PATCH)

- 2026-08-25 — [high-quality/correctness] **Eleven write endpoints have no UI caller; §9's 360 module
  is unusable end to end.** Full analysis: `docs/verification/SPEC-REDTEAM.md`. The critical two:
  `POST /api/three-sixty/responses` (no 360 answering form exists anywhere, so no rater can ever
  submit — which blocks §8/§10/§11/§13 for every non-C-Level employee, since scoring refuses without
  a 360) and `PUT /api/calibration` (§10.2's target distribution and §10.3's threshold cannot be set,
  so §10.7's gate cannot open). Also: no 360 cycle/template creation (§9.1/§9.2), no manual leaver or
  transfer (§12.1/§12.3), no per-ratee rater editing or projects (§9.6), no individual 360 report
  (§9.8), and My Tasks omits 360 assignments (§4.4). Operator SCHEDULED the UI work on 2026-08-25:
  F1's 360 answering form first (it unblocks §8/§10/§11/§13), then F2's §10.2 target-distribution
  editor. The work is UI only — the domain logic is complete and tested. Missed because tests call
  route modules directly (reachability is invisible to a caller-supplying test) and because
  `prisma/seed-demo-cycle.ts` wrote the 360, its responses and the calibration target straight to the
  database, papering over every one of these during the browser pass. — operator — status: adjudicated(2026-08-25)

- 2026-08-25 — [high-quality/correctness] **A 360 score built from fewer than three raters is
  indistinguishable from one built from three.** §9.5 says "average the 3 ratios"; `overallRatio`
  averages over however many arrived (defensible — dividing by a hard 3 would penalise a ratee for a
  rater's departure), but `EmployeeScore` records no rater count, so the degradation is invisible on
  the scorecard, in the master export, and in the bonus derived from it. 26 of 33 ratees in the demo
  fixture had fewer than three raters available. **2026-08-26**: the count is now stated beside the figure on §9.8's
  individual report, with an explicit caution below three — so the degradation is visible where the
  360 is read. **2026-08-26, migration authorised by the operator**: `EmployeeScore` now carries
  `threeSixtyRaterCount` (migration `20260826120000_pms_three_sixty_rater_count`), written by the
  score run from the same `ratios` array `overallRatio` divided by — so the stored count and the
  stored score describe the same forms. It reaches §13.5's master export as a "360 Raters" column
  and §10's calibration screen as a caution below three, where §10.5's manual override is the
  judgement it informs.

  Three boundaries held on purpose. (a) **It changes no arithmetic**: `scoreEmployee` never sees it,
  `rawScore` does not read it, and §13.2's publish does not gate on it — whether a thin 360 should
  move a band is a §10 judgement made by a person. (b) **It is NULLABLE and not backfilled**: null
  means "this run predates the column", 0 would mean "nobody rated them", and backfilling would turn
  the first into the second — a false claim about a real score. Two CHECK constraints hold the shape
  (non-negative; never present without a `three_sixty_score` beside it). (c) **It is NOT on the
  employee's own scorecard**: §13.1 says the employee "never sees raw scores, component breakdown,
  any sign of calibration", and the denominator of one component is component breakdown. HR and the
  executive viewers see it; the employee sees their band.
  — operator — status: adjudicated(2026-08-25), fixed 2026-08-26

- 2026-08-25 — [high-quality] **No §5.5 reminder or §9.7 invitation is ever sent unless SMTP is
  configured.** The escalation ladder and the notification code are implemented and wired to the
  daily cycle sweep, but `lib/email.ts` no-ops without `SMTP_HOST`, which `.env.example` does not
  carry. The compliance record is still written, so this degrades to "the log is right, nobody was
  told". Operational, not a code defect. — operator — status: adjudicated(2026-08-25)

- 2026-08-24 — [maintainable/correctness] **`Kpi` is not registered in `SOFT_DELETE_MODELS`,
  and two independent Phase 2 units hit it.** `lib/prisma/soft-delete-extension.ts` filters
  `User`, `Employee`, `Department`, `OrgEntity`. `Kpi` carries `deletedAt`/`deletedBy` but is
  absent, so `prisma.kpi.delete()` is a HARD delete and `prisma.kpi.findMany` returns withdrawn
  rows. The sharpest consequence named: **a soft-deleted KPI counted toward the §5.3 total would
  let a set sign at a weightage the employee cannot see.** Both units worked around it
  independently with an explicit `deletedAt: null` on every KPI read, and `weightageSummary` in
  `lib/pms/kpi-select.ts` does the same, so the shipped code is correct today.
  **An important qualification:** registering `Kpi` would fix top-level reads but NOT the case
  that actually matters here. That file's own comment records that the extension filters the
  top-level `where` only — a relation pulled via `include`/`select` (which is exactly how
  `weightageSummary` reads `participant.kpis`) still surfaces soft-deleted children. So the
  explicit filters are the real fix in both worlds, and registration is defence in depth plus
  recycling-bin visibility, not a substitute.
  **FIXED 2026-08-24** with the operator's approval for the Ask-before surface. `Kpi` is now in
  `SOFT_DELETE_MODELS`, and the KPI route's DELETE switched from a hand-rolled `update` to
  `prisma.kpi.delete()` — verified against PostgreSQL, that path logs the audit action as
  **DELETE** where the hand-rolled one logged **UPDATE**, because the extension infers a soft
  delete by comparing `deletedAt` across before/after and the route's narrow select hid it. Both
  paths keep the row; normal reads return 0 of 2 withdrawn KPIs. The explicit `deletedAt: null`
  filters stay at every call site, for the nested-include reason above. — status:
  fixed(this commit)

- 2026-08-24 — [scalable/pillar] **Two unbounded `findMany` calls in
  `app/api/cycles/[id]/stages/route.ts`, marked `pillar:scalable-ok`.** Both read
  `cycle_stages` for one cycle. The table is bounded by the domain rather than by a `take`: §2
  fixes exactly three touchpoints, `CycleStageKind` has exactly three members, and
  `@@unique([cycleId, kind])` makes a fourth row for a cycle unrepresentable. The `kind: { in: kinds }`
  filter is additionally capped at 3 by zod (`updateCycleStagesSchema`). Paginating a
  three-row read would add a cursor to a list that cannot grow, and would make the
  three-deadlines-together UI fetch in pages. Re-examine if a later phase adds a stage kind —
  the bound is the enum, so it moves when the enum does. — Tariq Al-Naaimi — status:
  adjudicated(2026-08-24)

- 2026-08-24 — [secure/data] **`employees.basicSalary` is plaintext at rest — options written
  up, DECISION OWED before real data.** The column is Restricted (SECURITY.md §1) and every
  control on it today is access-layer: omitted from the `select` for unentitled actors, scrubbed
  from audit rows, banned as an export column, redacted in the SQL diagnostics helper, rendered
  `[redacted]` in import previews. All verified on live payloads. **None of them survive direct
  database read** — a connection string, a support export or a backup yields every salary in one
  `SELECT`. **ADR-067** lays out four options with real costs and recommends accepting plaintext
  now, targeting "don't store it at all, read from Odoo at bonus time" for Phase 5, and taking
  app-level AES only if policy requires it. One correction the write-up makes explicit, because
  it is the easiest thing to get wrong here: encryption at rest would NOT close the platform-admin
  path in the finding above — that is an application-path disclosure and the app would decrypt for
  them. **Not decided by me:** accepting a risk about real colleagues' pay is the operator's
  signature. — Tariq Al-Naaimi — status: adjudicated(2026-08-24), decision SCHEDULED and BLOCKING
  on the first real import; interim posture accepted because the fixture holds no real person's pay

- 2026-08-24 — [secure/architecture] **A platform ADMIN can reach full HR Super Admin access,
  by TWO independent routes. Reproduced; recorded, not "fixed", because the fix is not code.**
  The post-push review raised route 1 at ~55 confidence and could not confirm it. Both routes
  were then reproduced end to end against a real database and live wire payloads.
  **Baseline (holds):** a `Role.ADMIN` with no `Employee` record gets **0 employees and no
  `basicSalary` key** — least privilege by default is real.
  **Route 1 — provision-and-claim.** `POST /api/users` takes the email _and_ the password. An
  admin created a login on the unclaimed HR Super Admin's address (`1100`, Fatma Al-Rashdi),
  signed in, and `resolveActor`'s first-login email match linked them: `GET /api/pms/me` returned
  `pmsRoles: ["HR_SUPER_ADMIN"]` with `orgWide`, `configure`, `viewCompensation`, `applyImport`,
  `runCalibration` and `exportMasterResults` all true, and `GET /api/employees` returned 20 rows
  per page **carrying `basicSalary`**.
  **Route 2 — password takeover.** `PUT /api/users/[id]` sets any user's password. Run against
  the _already linked_ account — the state a legitimately onboarded HR Super Admin is in — it
  granted the same access. **This is why route 1 was not simply patched:** narrowing the email
  auto-link would have left route 2 wide open and produced a false sense of closure.
  **WHY recorded rather than fixed:** this is what "the platform admin manages credentials" means
  in any system; you cannot code around an actor who can set passwords. The decision is _who
  holds `Role.ADMIN`_, and that is the operator's. ADR-065 and the `unlinkedActor` docstring both
  overstated the guarantee ("platform administration does not confer HR authority") and have been
  corrected to say what is actually true.
  **Compensating control, verified:** both routes are audited. Route 1 writes `CREATE User` plus
  an `UPDATE Employee` carrying `{"userId": {"from": null, "to": "<new user>"}}` — an explicit
  record of an identity being claimed. — Tariq Al-Naaimi — status: adjudicated(2026-08-24), with
  the audit gap below carved out as the actionable remainder

- 2026-08-24 — [secure/observability] **An admin password reset is audited as an
  indistinguishable blank.** Falls out of the finding above. `passwordHash` is in `SCRUB_FIELDS`,
  correctly — the hash must never reach an audit row. But the scrub drops the whole diff, so the
  row lands as `UPDATE | User | <admin> | changes: null`. An admin taking over an HR Super
  Admin's credentials and an admin fixing a typo in someone's display name are byte-identical in
  the audit trail. Since detection is the _only_ control that survives against a hostile admin
  (see above), the one control that matters is blind to the one action that matters.
  **FIXED 2026-08-24, and the diagnosis above was wrong in an instructive way.** The scrub was
  never the cause: `computeChanges` already emitted `{"from":"[redacted]","to":"[redacted]"}` for a
  scrubbed field that changed. The real cause is that **`computeChanges` iterates the keys of
  `after`, and `after` is whatever the CALLER selected** — `PUT /api/users/[id]` returns six
  columns, none of them `passwordHash`, so the changed column was never present to be compared.
  That makes it a GENERAL defect: any audited update with a narrow `select` under-reports what
  changed. The audit extension now re-reads the full row before diffing (`before` was already
  fetched unselected, so the pair is now symmetric); a null re-read means the update soft-deleted
  the row, and the caller's projection is kept. Verified against PostgreSQL: a password reset logs
  `{"passwordHash":{"from":"[redacted]","to":"[redacted]"},"passwordChangedAt":{...}}` and a rename
  logs only `name`. Pinned by three tests in `tests/contracts/audit-scrub.test.ts`, one of which
  documents the hazard itself.
  — Tariq Al-Naaimi (approved the Ask-before change to `lib/prisma/audit-extension.ts`) —
  status: fixed(this commit)

- 2026-08-24 — [high-quality/correctness] **A concurrent double-apply killed the loser with a raw
  Prisma error — FIXED.** The review flagged this at ~60 confidence without reproducing it. Two
  simultaneous `applyImport` calls on one PREVIEWED batch: both passed the `status !== "PREVIEWED"`
  read (it is a read, so it does not serialise), both ran the creates, and the loser died on a
  unique-constraint violation whose message carried a stack trace and an internal source path —
  reaching the operator as an opaque 500. The review's reasoning that data stays intact was
  **correct** (verified: headcount moved by exactly the 2 expected, no duplicates), so this was a
  UX and diagnosability defect, not corruption.
  **Fix:** claim the batch as the FIRST statement inside the transaction with a conditional
  update (`where: { id, status: "PREVIEWED" }`), so the flip is the point of contention. The
  second transaction blocks on that row, then matches nothing and aborts before touching an
  employee. Prisma's extended `where` keeps it a single-row update, so it still audits like one.
  **Also fixed, and this one was mine:** the route decided 409-vs-500 by regex over the message
  text, so the two digest checks added earlier the same day landed as **500s**. Replaced with a
  typed `ImportConflictError`, pinned by a contract test. Verified: winner applies 2, loser gets
  `ImportAlreadyAppliedError` ("This import has already been applied."), exactly 2 rows written,
  and a later re-apply is a clean conflict too. — status: fixed(this commit)

- 2026-08-24 — [secure/correctness] **Import apply confirmed the SHAPE of a plan, not its
  contents — FIXED.** Found by the post-push `senior-code-reviewer` breadth pass and reproduced
  independently before fixing. `applyImport` re-parses the file submitted at confirm time (it
  must — the rows carry Restricted salary, so they are deliberately not persisted in
  `previewJson`) and compared only three integers against the reviewed batch: `rowsCreated`,
  `rowsUpdated`, `rowsRejected`. Two different sheets with one create each produce identical
  counts, so a substituted file was written as though it were the reviewed one. The whole reason
  the two-step preview→confirm flow exists is "the operator confirms exactly what they were
  shown"; that was aspiration, not enforcement. The realistic trigger is mundane, not
  adversarial: re-uploading a newer export at the confirm step that happens to add the same
  number of people. **Fix:** a `planDigest` — SHA-256 over every field the plan would write,
  sorted by `odooId` so file order is not content — persisted inside `previewJson` at preview
  and re-checked at apply. Salary is inside the digest deliberately: it is the most sensitive
  thing an import can change, and a one-way hash costs no confidentiality to anyone who could
  read it back. The count check is KEPT alongside it — the two catch different things (counts
  catch the org moving under a plan; the digest catches a different file). **Verified end to end
  against PostgreSQL 16:** previewing `export-v1.xlsx` (1 create) then confirming with a
  different 1-create file is refused, headcount unchanged 37→37, the substituted person not
  written; re-confirming with the correct file still applies. Three contract tests pin it,
  including that reordering the same rows does NOT change the digest (§3.2). — status:
  fixed(this commit)

- 2026-08-24 — [high-quality/correctness] **A duplicate email passed preview, then rolled back
  the whole batch at apply — FIXED.** Also from the breadth pass. `Employee.email` is `@unique`,
  but nothing checked it: not within the file, and not against the database. A sheet containing
  a repeated address — a typo, or a leaver's address reused for a new hire — previewed as "0
  rejected", and then `tx.employee.create` threw a raw P2002 inside the batch transaction,
  rolling back **every other create and update in the file** and surfacing as an opaque 500 with
  no indication of which row or why. Exactly inverted from §3.4's promise that a row failing a
  rule is rejected with a reason. **Fix:** two batch-level rules in `validate.ts` —
  `email_duplicate` (repeated within the file) and `email_in_use` (held by a different existing
  employee, named in the message). A row keeping its OWN email on re-import is correctly not a
  clash (§3.2's stable-key update path). Placed in `validate.ts` rather than `checks/identity.ts`
  to keep that module's stated "none of these consult the database" property true. The
  `emailOwners` map is built from the employee read `loadContext` already performs, so it costs
  no extra query. **Verified end to end:** a two-row file where the second collides now previews
  as 1 create / 1 reject naming the holder, applies the legitimate row, and leaves the colliding
  one unwritten — no batch-wide rollback. — status: fixed(this commit)

- 2026-08-24 — [harness/gates] **The pre-push lint gate passed a warning it later rejected.**
  `npm run ship` reported green immediately before the a11y commit (`3f10367`), which introduced
  `useEffect(() => setHydrated(true), [])` in two auth forms; the very next `ship` on an
  unrelated change went RED on `react-hooks/set-state-in-effect` for those same lines. The most
  likely cause is ESLint's cache not invalidating for files changed within the same session. The
  consequence is real: code that trips a lint rule reached `main` behind a green gate. The
  offending pattern has been replaced with `useSyncExternalStore` (the correct hook for a value
  that differs between the server and client snapshot, and no cascading render), so the tree is
  clean either way. **Fix owed:** confirm whether `scripts/ship.mjs` passes `--cache` to ESLint
  and, if so, whether its cache key covers mtime reliably; a gate that can pass stale is worse
  than a slower one. — status: adjudicated(2026-08-24), fix SCHEDULED in the template repo where
  `scripts/ship.mjs` is maintained

- 2026-08-24 — [secure/high-quality] **Pre-hydration submit put credentials in the URL on four
  forms — FIXED.** Found while running the axe pass that closed the Phase 1 QA gap; the axe run's
  own login step failed with the password sitting in the query string, which is how this
  surfaced. A `<form>` whose only submit path is a React `onSubmit` handler still submits
  **natively** if the user gets there before hydration, and a native submit on a form with no
  `method` is a **GET** — so the field values land in the URL, in browser history, and in any
  `Referer` the next navigation sends. Reproduced deliberately with a 900 ms script delay:
  `/en/login?email=victim%40example.com&password=not-a-real-password-probe`. Same shape on
  `reset-password` (worse — a NEW password beside the reset token), `forgot-password` (an email),
  and `components/users/UserForm.tsx`. **Fix:** `method="post"` on all four, so even a submit that
  slips past the gate carries values in a body rather than a URL; plus the submit button gated on
  a `hydrated` flag on the two password forms. Re-ran the same reproduction: URL clean, and the
  normal login path still works (the full axe pass authenticated fine afterwards). — status:
  fixed(pending-commit)

- 2026-08-24 — [high-quality/a11y] **Two WCAG AA contrast failures on the login brand panel —
  FIXED.** The `/design-qa` axe tier that `docs/findings-register.md` scheduled as the first
  post-deploy action found the four PMS screens clean (0 violations, light and dark) but returned
  five `color-contrast` **incomplete** results on the login panel — axe cannot score text over a
  gradient, so these were never reported as violations. Measured by sampling the rendered pixels
  with the text hidden: the value line was **3.17:1** and the copyright **2.26:1** against a
  4.5:1 requirement. The gradient (`from-primary to-primary/80`) fades toward the page
  background, so the panel was **lightest exactly where the smallest text sat**. Raising the
  alpha alone does not fix it — white at /80 on solid primary is 3.60:1. **Fix:** solid
  `bg-primary` and full-opacity foregrounds, which is what `brand.config.ts` asks for anyway
  ("ONE accent, solid — no gradient on product surfaces"); hierarchy now carried by size and
  weight. Re-measured: **4.88:1 on all four elements in both themes**, and axe's unresolved count
  dropped 5 → 1 (the remaining one is the `aria-hidden` monogram, measured 4.88:1). **Also fixed
  in the same pass:** the login panel and page metadata still read "Fullstack Next.js
  application" — a rebrand leftover. **Note for the template:** this panel is template-authored,
  so every fork carries both the contrast bug and the placeholder tagline. — status:
  fixed(pending-commit) in this fork; template fix owed upstream

- 2026-08-24 — [harness/gates] **`qa-gate` (and its sibling receipt gates) evaluate
  `CLAUDE_PROJECT_DIR`'s HEAD, not the HEAD of the repository actually being deployed.**
  `.claude/hooks/qa-gate.mjs:59` resolves `const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()`.
  When a session's primary working directory is one repo and the deploy is run from a second
  checkout — the exact shape of `/first-fork`, and of this product being forked out of the
  template — the gate reads the WRONG repository. Observed here: `npm run deploy` from
  `rihal-performance-management` (HEAD `8b5b90b`) was denied citing HEAD `4fcfee9`, which is the
  template fork's HEAD. This is a **fail-closed** miss in the safe direction (it denied rather
  than allowed), but the failure mode in the other direction is the dangerous one: a receipt
  trailer sitting on the primary dir's HEAD would SATISFY the gate for a deploy of an entirely
  different, unreviewed repository. The receipt is also content-bound to a tree-sha, so a
  cross-repo receipt would be checking one repo's tree against another repo's gate.
  **Interim handling in this session:** the deploy is invoked with `CLAUDE_PROJECT_DIR` set to the
  repository being deployed, which makes the gate evaluate the correct — and, at that point,
  receipt-less — HEAD rather than a stale unrelated one. That is a correction of a wrong value,
  not a bypass: the gate still runs and still demands a receipt or a recorded skip at that HEAD.
  **Fix owed:** derive ROOT from the git toplevel of the invoking cwd (`git rev-parse
--show-toplevel`) and fall back to `CLAUDE_PROJECT_DIR` only when that fails; audit
  `review-gate.mjs`, `blueprint-gate.mjs`, `build-vs-buy-gate.mjs` and `bash-write-gate.mjs` for
  the same line. — Tariq Al-Naaimi — status: adjudicated(2026-08-24), fix SCHEDULED in the
  template repo, not here. **Why not fixed now:** the hook that misbehaves is loaded by the
  harness from `CLAUDE_PROJECT_DIR`, so patching this fork's copy would not change the behaviour
  of the session that hit it — the fix has to land in `Tariq-AlNuaimi/fullstack-vibe-template`'s
  `.claude/hooks/`, which is the template's harness surface and deserves a deliberate change with
  its own tests, not a rider on a product deploy. **Risk accepted in the interim:** the observed
  direction is fail-closed. The dangerous direction requires a receipt trailer to exist on an
  unrelated repo's HEAD at the moment of a deploy, and the deploy is operator-invoked, so it is
  not reachable without a person running one.

- 2026-08-24 — [quality/QA] **PMS Phase 1 deployed without a `/qa` receipt — `Gate-Skip: qa-gate`.**
  The three-tier orchestrator (design QA → functional QA → UAT) was NOT run. What WAS run, and is
  recorded with results in `docs/verification/pms-phase1/README.md`: the migration applied to a
  real PostgreSQL 16 database; 12/12 database invariants exercised by actual INSERT/UPDATE; the
  recursive-CTE chain walk on seeded data (depth 3, no cross-entity leakage); the import pipeline
  end-to-end including the §3.5 truncated-export case (2-of-36 file → 1 joiner, 0 deletions) and
  all seven §3.4 rejection rules; the full §4 permission matrix asserted on **live API payloads**
  for five roles (the line manager's response carries 8 rows and no `basicSalary` key at all); and
  four screenshots of the built screens including dark mode. Three real defects were caught and
  fixed this way (Excel writer seam returning a handle not a Buffer; the generated template's own
  `Manager (Employee ID)` header failing to parse; a malformed JSON body returning 500 not 400).
  **WHY waived:** the remaining `/qa` gap is a formal **axe accessibility audit** and a UAT
  report. Running design-QA's axe tier meaningfully wants a deployed URL, and this is a
  first deploy — the gate is circular at this point in the chain. The functional substance
  `/qa` would have covered was covered by hand and is evidenced above; what is genuinely
  untested is a11y. **NOT waived, scheduled:** run `/design-qa` (axe) against the deployed URL
  as the first action after the deploy lands, before HR review. — Tariq Al-Naaimi
  (operator chose this path explicitly when offered the alternative of running the full `/qa`
  first) — status: adjudicated(2026-08-24), with the axe run scheduled as the first post-deploy
  action

- 2026-08-21 — [secure/harness] **Round 12: the re-review found the FIFTH instance of the
  pattern, plus four more.** A second senior pass was commissioned specifically to hunt for a
  same-class gap introduced BY the round-11 fixes. It found five, all execution-verified. The
  pattern is now established beyond doubt: **each fix keyed off the SYNTACTIC SHAPE of the
  previous proof-of-concept rather than the SEMANTIC property it needed to enforce.**
  - **CRITICAL — `cat .{a..z}nv` read the live env file.** Round 11's brace fix split on commas.
    Bash's RANGE form has no comma, so the single "alternative" was the literal `a..z` and the
    secret name was never produced. Fixed by expanding alphabetic and numeric ranges.
  - **HIGH — both brace bounds FAILED OPEN.** Past depth 6 the unexpanded string was returned
    as if checked; past the alternative cap the remainder was silently dropped. Deep-nested and
    71-item payloads both walked through. A bound on a fail-closed guard must DENY what it
    cannot evaluate; `expandBraces` now reports completeness and an incomplete expansion denies.
  - **HIGH — a heredoc piped to an interpreter bypassed the write gate.** Round 11 read the
    interpreter from the opening line's FIRST word, so it recognised the direct form and nothing
    else; piping the same body into a shell has a different first word. Now the whole pipeline
    is examined.
  - **MEDIUM-HIGH — keeping an executed body resurrected the original false positive.** The body
    was copied verbatim, sweeping a nested DATA heredoc's content back into the scanned text —
    the precise bug `stripHeredocBodies` exists to prevent. Now recursive.
  - **MEDIUM-HIGH — a NEW false-positive denial on ordinary work.** Unifying the runner list put
    `sh`/`bash`/`zsh` into a whole-command regex OR'd against a separate removal-call regex, so
    a grep for a removal call followed by an unrelated strict-mode script run was hard-denied:
    the grep pattern supplied the removal text, the script run supplied the runner. On a guard
    with no tiering and no override. The destructive scan is now bound to the runner's quoted
    inline BODY, which is what the whole-command check was for in the first place.
    The reviewer also confirmed the `ship.mjs` accumulator fix as the one solidly-scoped repair of
    the four. **What this says about the method:** every round so far was caught by an independent
    pass, never by the author, and each round's fix was verified against its own PoC and shipped
    green. Regression tests are necessary and have not been sufficient — the tests encode the
    known shape, and the next gap is always the unknown one.
    — owner: operator — status: fixed(guard-probe 31+36+48 all clear; 77 hook tests; evidence
    `tests/harness/guard-probe.mjs`, `tests/harness/hooks.test.mjs`)

- 2026-08-21 — [secure/harness] **Four guard defects introduced by this session's own
  hardening, found by senior review, all fixed.** Recorded because two were CRITICAL bypasses
  of what CLAUDE.md calls the security floor and they existed on `main` for part of the day; a
  fork auditing these guards deserves the history, not just the fixed end state. The review's
  diagnosis is the durable part: **each hardening pass closed the specific gap its commit
  message named while reintroducing the same CLASS of gap one level over.**
  - **CRITICAL — brace expansion defeated `protect-secrets` entirely.** `cat .{e,x}nv` read
    `.env`. Brace expansion is a separate, EARLIER shell stage than globbing, and the rewritten
    glob check only looked for `*?[]`; the token was neither a glob nor the literal `.env`.
    Every caller funnels through `secretPath()`, so the archive/copy/curl/interpreter checks
    fell with it. Fixed by EXPANDING braces and checking each alternative — not by banning `{`,
    since `cat file.{ts,tsx}` is ordinary work and over-blocking a fail-closed guard is its own
    harm.
  - **CRITICAL — the two interpreter lists in `dangerous-commands` had diverged.** Round 8
    widened the per-segment `Set` with bun/npx/tsx/ts-node/sh/bash/zsh and left the
    whole-command regex untouched. That regex exists because the segment splitter is not quote
    aware, so a destructive call after a `;` was caught by neither. `node -e` with the identical
    body WAS denied, which is how it hid. Fixed by deriving both from one list — the duplication
    was the defect.
  - **HIGH — `bash-write-gate` heredoc stripping swallowed real writes.** The round-8 fix for a
    real false positive assumed heredoc bodies are inert data; for `bash <<'OUTER'` the body is
    a script, so a nested write to a new gated route was invisible. Now scanned when the opener
    is an interpreter, still stripped for data sinks.
  - **HIGH — `/ship`'s verdict counted silent skips as "ran".** Twelve early-returns said "I
    checked nothing" only in `out`, so they printed under `ran (N)`. Two are enforcement-quartet
    gates whose skip path is the normal state of a shallow clone. The first fix sniffed `out`
    and mislabelled `contract tests` as degraded — the mirror-image error, reverted. Every skip
    path now sets `warn`, guarded by a static invariant test, **which then found two more skip
    paths the review had not listed**.
    — owner: operator — status: fixed(see PR #116; evidence `tests/harness/guard-probe.mjs`,
    `tests/harness/hooks.test.mjs`, `tests/harness/ship-gates.test.mjs`)

- 2026-08-21 — [secure/harness] **The review's three UNCERTAIN items, settled by execution.**
  The reviewer rated these 55–65 and could not confirm them; all three were checked rather than
  left as folklore.
  - **CONFIRMED and fixed — `git push --all` / `--mirror` bypassed the protected-branch check.**
    Both push every branch, `main` included, without ever naming it, so a check that inspects
    ref tokens never saw them. Verified allowed beforehand, denied after.
  - **DISMISSED, deliberately — the case-sensitive `main`/`master` match is CORRECT.** Git
    branch names are case-sensitive, so `Main` is a different branch and pushing to it does not
    touch `main`. Denying it would add a false positive to a fail-closed guard. A repo whose
    default branch is literally `Main` would be unprotected; that is not this repo, and the
    fix would be to name the branch in the check rather than to match case-insensitively. A
    probe case records the dismissal so it is not re-raised as a bug.
  - **CONFIRMED and fixed — `retryAfter` reported the wrong reset when both buckets denied.**
    `rateLimit` returned the IP bucket's value whenever both denied, so a caller who waited
    exactly that long was still refused by the subject bucket — a `Retry-After` header that
    sends the client into a second 429. The two buckets share `windowMs` but not their start
    times (the subject bucket accumulates across IPs, which is the case it exists for). Now the
    later of the two. Correctness/UX, not a security gap: the denial itself always held.
    — owner: operator — status: fixed(tree evidence: `.claude/hooks/dangerous-commands.mjs`
    `--all`/`--mirror` branch, `lib/rate-limit.ts` `Math.max` on retryAfter)

- 2026-08-21 — [scalable/ops] **Docker base image + otel collector bumps — merged unverified,
  now verified and CLOSED.** #106 landed the node base image at `24.19.0` (was 24.18.0,
  `Dockerfile`) and `otel/opentelemetry-collector-contrib` at `0.159.0` (was 0.156.0,
  `compose.prod.yaml`) without either being exercised, because `ship:full` never reached the
  gates that would cover them. Two successive "this cannot run here" claims turned out to be
  "nobody tried":
  - **The DB gates.** `db-structure` and `integration` were assumed to need Docker. The web
    container ships a real PostgreSQL 16 natively (recipe in `docs/agent-memory.md`), and
    `scripts/test-integration.mjs` resolves a reachable `DATABASE_URL` FIRST — a native-Postgres
    path written for exactly this and never used. `integration` now runs 6 tests, 0 skipped.
  - **The docker gate.** Assumed unavailable; the daemon had simply never been STARTED. `dockerd`
    comes up fine (29.3.1). The gate then ran for real and went RED on `SELF_SIGNED_CERT_IN_CHAIN`
    — the build container not trusting the agent proxy's CA, i.e. environmental, not a defect.
    With the CA injected via a build-context mount (no tracked file changed), the risk this entry
    named — "a base image bump can change the glibc/OpenSSL under Prisma's engines" — is disproven:
    **glibc identical** (`2.36-9+deb12u14`), **OpenSSL identical** (`3.5.7`), and the native-module
    rebuild **succeeds** on 24.19.0 (`npm ci && npm rebuild @prisma/engines @sentry/cli sharp
@swc/core esbuild unrs-resolver @parcel/watcher` → DONE 46.5s, then `prisma generate` → DONE
    22.5s). Both collector images pull.
    The last gap was the final image assembly: `npm run build` inside the container failed on
    `next/font` reaching `fonts.googleapis.com`. **The operator's read was the right one** — that is
    not a sandbox artifact to work around, it is a real BUILD-TIME network dependency that every
    air-gapped, proxied or offline build hits. `next/font/google` is self-hosted at RUNTIME but
    fetches font files at BUILD time; the code comment asserted the former and was silent on the
    latter, which is why it went unnoticed. Replaced with `next/font/local` over two variable
    `.woff2` files vendored into `app/fonts/` (from the official `geist` package, SIL OFL 1.1; the
    package itself is NOT a dependency — two static assets do not need one). Verified: `npm run
build` succeeds with `HTTPS_PROXY` unset, and the **full Docker image builds end to end (exit 0)** on the node 24.19.0 base, with both fonts baked in as hashed static assets and the image
    running. — owner: operator — status: fixed(tree evidence: `app/fonts/*.woff2` +
    `app/[locale]/layout.tsx` using `next/font/local`)

- 2026-08-17 — [security/harness] `.claude/settings.json` `permissions.allow`/`deny` narrowed
  (red-team R2) — CLAUDE.md requires a register note for any change to the permission arrays. This
  change **narrows** capability rather than widening it: `Bash(npx prisma *)` → verb-scoped
  (`generate`, `migrate dev|deploy|status`, `studio`, `db seed`); `Bash(find . *)` → read-only forms;
  `Bash(git push *)` → `claude/*` refspecs; `Bash(docker compose down*)` → no flags. Destructive
  verbs (`migrate reset`, `db execute`, `db push`, `find -delete/-exec`, `down -v`, pushes to `main`,
  `shred`) moved to deny. **Residual risk accepted:** deny patterns are prefix-lexical and therefore
  evadable by spelling; `dangerous-commands.mjs` is the semantic backstop (R2b) and
  `tests/harness/guard-probe.mjs` proves both layers. **Operator-approved** — see
  `docs/AUDIT-DECISIONS.md` Phase 1 R2 — Tariq Al-Naaimi — status: fixed(see branch
  `claude/security-phase1`; evidence `tests/harness/guard-probe.mjs`)

- 2026-07-16 — [harness-v2 V2-001/correctness] `bash-write-gate.mjs`'s redirection regex scans
  the WHOLE command string including heredoc bodies / quoted example text, so a Bash command that
  merely MENTIONS a gated path (`> app/api/foo/route.ts` in documentation text, a `git commit -m`
  body, an `echo`) false-denies even though no write occurs (senior-review 2026-07-16, confidence
  85; observed live — a verification command this session was itself denied). WHY not fixed now:
  the fix (strip heredoc bodies / model shell-syntax vs data before scanning) is real parser work,
  risky at the session's context limit. Interim mitigation: avoid embedding literal gated-path
  redirect text in Bash commands. — owner: operator — **status: fixed(2026-08-21)** — heredoc
  BODIES are now stripped before anything scans for writes (the opener still redirects and is
  still gated), and the redirection scan is quote-aware, so a `>` inside a quoted string is text
  rather than a redirect. The feared "real parser work" turned out to be a small line-wise
  heredoc strip plus a character scanner that tracks quote state — no shell grammar needed.
  Regression tests in `tests/harness/hooks.test.mjs`, verified to FAIL against the pre-fix hook.

- 2026-07-16 — [harness-v2 V2-001/secure] `bash-write-gate.mjs` is evadable by writes that avoid a
  literal `>`/`tee`/`cp`/`sed -i` token: a shell variable holding the path (`F=…; cat > "$F" …`) or
  an interpreter one-liner (`node -e "fs.writeFileSync('app/api/x/route.ts',…)"`) creates a new
  uncovered gated file without tripping the gate (senior-review 2026-07-16, confidence 88). WHY not
  fixed now: the hook is best-effort by design (its header says so) and the Write-tool gates still
  catch the normal path; closing these needs variable-tracking / interpreter-verb heuristics. —
  owner: operator — **status: fixed(2026-08-21)** — both spellings close. Literal single-line
  `VAR=value` assignments are collected and `$VAR` / `${VAR}` expanded in every candidate target,
  so `F=app/api/x/route.ts; cat > "$F"` resolves. Interpreter one-liners are scanned for path-shaped
  string literals, but ONLY when the body also contains a write call (`writeFileSync`,
  `appendFileSync`, `createWriteStream`, `write_text`, …) — that condition is what keeps a one-liner
  which merely READS a gated path from being denied, and it has its own counter-case test. Still
  deliberately not a shell: multi-line or computed assignments are out of scope, and the hook stays
  fail-OPEN. Regression tests verified to FAIL against the pre-fix hook.

- 2026-07-11 — [quality/ai] ai-eval /ship gate is DORMANT — the LLM-as-judge eval gate
  (`scripts/ai-eval.mjs`, wired into /ship phase B) is a no-op that exits 0 (SKIP) until a fork
  BOTH sets AI_API_KEY and writes >=1 tests/ai-evals/*.eval.ts fixture (and points AI_EVAL_BASE_URL
  at a running/deployed app). The pristine template has neither, so it always SKIPs green — AI
  output-quality scoring is unenforced here BY DESIGN, mirroring the dormant lhci gate (ADR-020
  dormancy pattern). Not silently dropped: it self-activates the moment a fork turns AI on + writes
  fixtures, and a CI variant (ai-eval.yml against a preview URL) is scheduled to land at the
  ADR-007/037 Actions-activation line. — owner: operator — status: adjudicated(2026-07-11)
  (accepted: dormant-by-design gate on the ADR-020 pattern; self-activates per-fork)

- 2026-07-11 — [quality] WS-5 pgvector RAG seam (ADR-043) is UNVERIFIED in-session —
  lib/ai/embeddings.ts + lib/ai/rag.ts + prisma/migrations/20260711120000_pgvector_rag were authored
  to spec, but there is **no pgvector-enabled Postgres and no embeddings egress** in the build
  environment, so the migration is **UNAPPLIED** and no provider round-trip or vector query ran here.
  Like the WS-1 distroless image wave-off, verification is delegated to a fork/CI with the
  infrastructure. Highest-risk unknowns a fork must confirm: the `vector` extension + `<=>` cosine
  operator + HNSW index resolve on the target Postgres (Neon supports `vector`), and the chosen
  model's dimension matches `vector(1536)` (voyage-3 / embed-english-v3.0 emit 1024 — ALTER the
  column + set EMBEDDINGS_DIMENSIONS in lockstep, else INSERT fails loud). **Not silently dropped —
  recorded for the operator to adjudicate**; the fix at activation: apply the migration against a
  pgvector DB, set EMBEDDINGS_PROVIDER + EMBEDDINGS_API_KEY, and exercise ragUpsert/ragQuery. —
  owner: operator — status: adjudicated(2026-07-11) (accepted: infra-unavailable in-session;
  verification delegated to a pgvector-capable fork/CI, same posture as the WS-1 image wave-off)
  — **UPDATE 2026-07-17 (V2-402): the pgvector SUBSTRATE is now VERIFIED in-session** against
  native Postgres 16 + pgvector 0.6.0 (the env-unblock recipe, agent-memory 2026-07-17). The
  migration `20260711120000_pgvector_rag` is applied, and `tests/integration/pgvector.test.ts`
  (3/3 via `npm run test:integration`; 6/6 across the full two-file integration suite) proves the highest-risk unknowns this wave-off named: the
  `vector` extension + the `<=>` cosine nearest-neighbor query (returns the aligned doc, distance
  ~0) + the HNSW index in the plan (`document_embedding_embedding_cosine_idx`) + a wrong-dimension
  INSERT failing LOUD (the 1024-trap), all pass. The test SKIPS gracefully with no DB. **STILL
  UNVERIFIED:** the embeddings PROVIDER round-trip (text→vector via voyage/cohere) — needs
  `EMBEDDINGS_API_KEY` + egress this env lacks. **ADJUDICATED — SPLIT (operator, 2026-07-17):**
  (a) the **DB-substrate half is `fixed(8fb4737)`** — the `vector` extension + `<=>` cosine query +
  HNSW plan + dimension-trap are proven by `tests/integration/pgvector.test.ts` (3/3) against native
  Postgres 16 + pgvector; (b) the **provider round-trip half stays `waived`** — `ragUpsert`/`ragQuery`
  through a real embeddings provider is deferred until a fork sets `EMBEDDINGS_PROVIDER` +
  `EMBEDDINGS_API_KEY` with egress (fix at activation: apply the migration, set the keys, exercise the
  round-trip). The two halves are tracked independently; only the substrate is closed.

- 2026-07-11 — [quality] WS-6 Ory Polis SSO/SCIM seam (ADR-045) is UNVERIFIED in-session —
  lib/sso/* + app/api/internal/scim + the generic OIDC provider in lib/auth.ts + the `sso` compose
  profile were authored to the documented Ory Polis / BoxyHQ dsync contract, but **no live Polis
  sidecar was booted**, so the OIDC handshake params (`checks:["state"]`, client_secret_post) and
  the SCIM webhook shape ran no real round-trip. ADR-045 + the blueprint promised this line; it is
  now recorded (senior-review 2026-07-11 flagged the promised-but-missing entry as a governance gate
  hole). Verification delegated to a fork/CI with a real IdP, same posture as the WS-1 image + WS-5
  RAG wave-offs. Fix at activation: `--profile sso` up, create a Polis SSO connection, complete a
  SAML→OIDC login + a dsync provisioning event end-to-end. — owner: operator —
  status: adjudicated(2026-07-11) (accepted: infra-unavailable in-session; verification delegated to
  a Polis-capable fork/CI)

- 2026-07-11 — [secure] ADR-041 P0 item (c) — **SAST-as-a-hard-CI-gate + `zizmor` action-pin
  audit are DEFERRED to CI activation, not landed in WS-2.** ADR-041 and the enterprise-P0
  blueprint (AC-4.3) list "promote `sast.yml` from dormant to a hard blocking gate" + add `zizmor`
  as P0. On the current free GitHub plan Actions billing is blocked, so every CI workflow —
  `sast.yml` included — is intentionally dormant (`on: workflow_dispatch` only; ADR-007/037): flipping
  the push/PR triggers now would fail-in-2s, not gate anything. So the _hard-gate_ half is only
  meaningful once CI activates (at `/handoff` to a paid-Actions team, or when billing unblocks) — the
  same activation line ADR-037 already defines. **Interim control:** the Semgrep ruleset is mirrored
  locally by the `/audit` skill (runs on demand), and the trivy-pin + SHA-pin halves of ADR-041 P0
  DID land in WS-2a. **Update 2026-07-13 (ADR-050 account-free slice):** the `zizmor` gate is now
  AUTHORED as a dormant workflow (`.github/workflows/zizmor.yml` — PyPI-pinned `zizmor==1.26.1`,
  fails on unpinned actions/dangerous triggers, SARIF upload), so the fix at activation shrinks to
  restoring the real push/PR triggers on BOTH `sast.yml` and `zizmor.yml` — no authoring work
  remains. **Not silently dropped — recorded here for the
  operator to adjudicate.** — owner: operator — status: adjudicated(2026-07-11) (accepted:
  program-level deferral to CI activation — the risk description stands, but the _hard-gate_ half is
  only meaningful once Actions runs; interim control is the local `/audit` Semgrep mirror + the
  landed trivy/SHA pins. RE-OPENS at the CI/Actions-activation line — `/handoff` to a paid-Actions
  team, or billing unblocking — when `sast.yml`'s and `zizmor.yml`'s push/PR triggers are restored)

- 2026-07-02 — [secure/maintainable] pristine-flag CLEARING is best-effort (warn-only, no
  retry/ack): `new-project.mjs` reads back `project.config.json` via the GitHub Contents API
  immediately after template-`generate` (which populates the file tree asynchronously) with no
  poll/retry, and `deploy.mjs` rewrites the flag only in the local working copy and relies on the
  operator to commit. If either clear silently fails, the fork keeps `"pristine": true` and — until
  it runs `/scaffold-entity` — ships GREEN with zero domain models, narrowly reopening the bypass
  the pristine-flag fix closed (originally commit 34f1114, since squashed away — see the entry below) (senior-review 2026-07-02, confidence 84) — WHY deferred: the
  robust fix (mirror new-project's existing env-propagation retry loop for the Contents read + a
  `dbAck`-style breadcrumb so `scanDbStructure` refuses a stale `pristine:true` whose clear failed)
  is Ask-before fork-script surgery, and Workstream B item 4 already reopens these three provisioning
  scripts next session; risk is narrow (only a not-yet-scaffolded fork whose clear silently failed)
  — owner: operator — status: adjudicated(2026-07-02) scheduled into Workstream B item 4

## Standing wave-offs promoted to documented trade-offs

<!--
When a wave-off is a permanent, intentional design choice (not a deferral), it
graduates out of the live register into a documented "known trap" in CLAUDE.md or
an ADR — then delete its line above. These are the already-documented ones, kept
here as pointers so they aren't re-litigated as new findings:
-->

- File uploads not wired; PDF export intentionally absent from `lib/export.ts` (ADR-006).
- Rate limiter is in-memory per-instance (fine single-instance; Upstash via `/scale-up`).
- CSP allows `'unsafe-inline'` script+style (AntD SSR + Next bootstrap).
  (See CLAUDE.md "Known traps" for the full list.)
- 2026-07-17 — [debt sunset, V2-409] **AntD type-shim** (`components/shared/table-types.ts`) —
  ✅ **CLOSED WON'T-DO 2026-07-25** (operator decision; OPEN-ITEMS item 13). Was listed as
  transitional debt to retire "at the next DataTable refactor". Retirement was measured before
  being attempted: a 605-line AntD→`ColumnDef` conversion core plus **11** column-authoring sites
  re-authored, plus ~10 list screens visually re-verified under the binding V2-301 loop — for zero
  user-visible change, on a surface that works. **Reclassified from debt to a deliberate
  abstraction**; the file header now says so. Not deferred — deferral would keep re-surfacing it.
  If `DataTable` is ever rewritten for a real reason, the shim goes with it as a side effect.
- 2026-07-17 — [debt sunset, V2-409] **bcryptjs** (`lib/password.ts`) — ✅ **SUNSET COMPLETED
  2026-07-25** (OPEN-ITEMS item 12). Was kept ONLY to verify legacy `$2*` hashes and auto-upgrade
  them to Argon2id on next login. The stated condition was "0 legacy hashes for 90 days"; the
  **0 was verified** (`SELECT count(*) … LIKE '$2%'` = 0 against the seeded DB, 2026-07-25) but the
  **90-day durability half could NOT be** — this container has no long-lived deployment to observe.
  The operator was shown that gap explicitly and chose to remove now anyway; recorded here so the
  waived half is not silent. Removed: the import + the bcrypt branch in `verifyPassword`,
  `npm uninstall bcryptjs`, and the legacy-accepts test INVERTED to assert rejection.
  **Consequence, deliberately accepted:** Argon2id is now the only supported algorithm, so a
  pre-ADR-039 fork whose users have not logged in since the migration will find those logins
  failing — recoverable only via the password-reset flow (no data loss). A fresh fork only ever
  writes Argon2id, so this is a no-op for anything created from the template. The caveat is
  documented at the top of `lib/password.ts` for anyone running `/sync-from-template`.
- 2026-07-17 — [awareness, V2-405] **`qs` moderate advisory (dev-only)**: adopting
  `@stryker-mutator/core` (V2-405) pulled a transitive `qs` (via `typed-rest-client`) carrying a
  **Moderate** DoS advisory (GHSA — below `/ship`'s High+ npm-audit gate, so it does not red). Dev/
  mutation-testing tooling only, never in the runtime bundle. Awareness line, not a wave-off; clears
  when the upstream chain bumps `qs`. (Surfaced by the senior review; noted per its recommendation.)
- 2026-07-17 — [env constraint, V2-401/ADR-061] **testcontainers container-run acceptance**: the
  `ship:full` integration gate provisions an ephemeral `pgvector/pgvector:pg16` container via
  `@testcontainers/postgresql` when a Docker daemon is present. THIS build container has no daemon,
  so the container path was verified by construction + the honest-skip path, while the actual suite
  round-trips were verified against the persisted **native Postgres 16 + pgvector** DB
  (`scripts/test-integration.mjs` path 1, 6/6). The container bring-up itself is "verified where
  Docker present" (CI / a dev box with a daemon) — same degrade-to-WARN posture as the ADR-030
  docker-image gate; not a deferral, an environmental constraint.
