---
name: manual-uat
description: Agent-driven MANUAL user acceptance testing -- the agent opens a real browser (Playwright MCP) and acts like a real user, typing real data, deliberately triggering input/validation errors, switching role logins, and confirming the live RBAC behavior matches what the code actually enforces. Every flow gets a HAPPY path (valid data, intended journey) AND a WORST path (invalid/adversarial input, boundary values, unauthorized access, role-crossing). Captures real UI/UX issues, real input errors, action/audit monitoring, and per-role user stories. The exploratory, judgment-driven complement to the canned /uat. Trigger phrases: "manual uat", "walk through it like a real user", "exploratory uat", "test it by hand", "check the RBAC live", "verify permissions per role", "/manual-uat", "drive the app as each role", "happy path and worst path".
---

# /manual-uat — manual, role-by-role acceptance testing through a live browser

The exploratory sibling of `/uat`. Where `/uat` runs **canned Playwright specs**,
`/manual-uat` has **you (the agent) drive a real browser by hand** via the
**Playwright MCP** — opening pages, typing real values, hitting submit, reading
what actually happens, and exercising judgment about UI/UX the way a human tester
would. It is the "sit down and actually use the thing as each kind of user" pass.

It does **two tracks for every flow**:

- **Happy path** — the intended journey with valid, realistic data: it works, the
  feedback is honest, the data lands, the audit log records it.
- **Worst path** — the adversarial journey: empty/invalid/oversized/boundary
  input, wrong types, duplicate keys, XSS-ish strings, double-submits, the back
  button mid-flow, **and unauthorized access** (a role reaching for something it
  must not). The app must fail *safely and legibly* — a zod message at the
  boundary, a 403, a guard redirect — never a stack trace, a silent success, or a
  green toast over a real failure.

Like `/uat`, this **runs and reports** — it does not change app code. Findings come
back as a prioritized report; fixes are a follow-up.

> **Where it sits.** This is a Tier-3 (UAT) activity in the QA system
> (`docs/uat-rubric.md`), run by `/qa` after design QA and `/ship`. The operator
> signs off. It is **not** a security pentest (`/audit` + the planned `/vapt` own
> that) — but the worst-path + RBAC tracks deliberately probe the authz boundary
> from the *outside*, which canned UAT does not.

## Why it's different from `/uat`

| | `/uat` | `/manual-uat` |
|---|---|---|
| Driver | canned Playwright specs | **the agent, live, via Playwright MCP** |
| Input | a generic form-filler | **real, hand-chosen values incl. adversarial ones** |
| Judgment | assertions only | **human-style UI/UX critique + user-story sense-making** |
| RBAC | section-reach matrix (Build B) | **live behavior diffed against the code-derived matrix, both tracks** |
| Output | HTML + PDF evidence pack | **prioritized findings report (`uat-results/manual-uat-report.md`)** |

Use `/uat` for the repeatable regression evidence; use `/manual-uat` to actually
*feel* the app and catch what canned specs can't (confusing copy, dead controls,
mislabeled errors, a VIEWER who can see a button they can't use, an EDITOR who can
hit an admin API directly).

## Prerequisites

1. **Playwright MCP** must be available — this skill drives the browser through it.
   This repo ships `.mcp.json` wiring the `playwright` server (`@playwright/mcp`).
   **First, check the MCP tools (`browser_navigate`, `browser_click`, …) are actually
   present in your session.** If they are NOT, **stop and surface the error to the
   operator** — name the missing tools, tell them to approve the server and restart the
   session. **Never silently fall back to the canned `/uat` specs and call it a manual
   run** — that is a different thing and reporting it as manual-uat is dishonest. (If the
   operator declines MCP, the honest fallback is `/uat --full`, stated as such.)
2. **A running target.** Prefer a deployed preview/prod URL (matches the
   share-via-URL workflow); otherwise local `http://localhost:3000` with a running,
   seeded DB (`make db-up` + `npm run prisma:seed`).
3. **Role logins.** Admin is the seeded `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`.
   For the other roles, run `npm run manual-uat:users` to upsert one user per non-admin
   role; creds come from `UAT_<ROLE>_EMAIL` / `UAT_<ROLE>_PASSWORD` (falling back to
   `SEED_ADMIN_PASSWORD`). Never hardcode or print passwords.
   **Production refusal (built in):** `manual-uat:users` guards before writing any User
   row — it exits with an error if `NODE_ENV === "production"`, and it **allowlists local
   hosts**: it refuses unless `DATABASE_URL`'s host is `localhost` / `127.0.0.1` / `[::1]`.
   So a hosted/prod connection string (e.g. a `.neon.tech` branch reached from a
   `development` env) is refused, not written to. It runs only against a local/test DB;
   never override the guard to write to prod.

## Step 0 — build the benchmark FIRST (so the RBAC check is real)

Before touching the browser, run:

```
npm run manual-uat:matrix
```

This statically parses the code and writes the **expected** permission matrix to
`uat-results/rbac-expected.json` (plus a printed table). It auto-detects which of
**two authorization models** the fork uses, so the same command works everywhere:

- **Tier model** (the template default) — the wrapper *is* the gate: `withAdminAuth`
  → ADMIN, `withEditorAuth` → ADMIN+EDITOR (or the fork's `WRITE_ROLES`), `withAuth`
  → any authed, `withApiAuth`/`withInternalAuth` → machine.
- **Capability model** (forks like rihal-staffing-suite) — `withCapabilityAuth("<cap>")`
  names a capability resolved against the role→capability catalog
  (`CANONICAL_PERMISSIONS` in `lib/permissions-data.ts`). The matrix shows the
  **canonical** grants and prints a ⚠ reconcile-vs-live banner (see Step 0b).

It also flags **anomalies** — a route with no recognized auth wrapper that isn't on
the public allowlist (report immediately; likely a real bug), an unknown/typo'd
capability, or a runtime-computed capability the static pass can't resolve.

### Step 0b — reconcile against LIVE permissions (capability model only)
For the capability model, **`rbac-expected.json` is canonical, NOT live.** If the
app has an admin-editable permissions table (`role_permissions`, resolved in
`lib/permissions.ts`), an admin can grant/revoke at runtime, so the running app
legitimately differs from the code defaults. **Before judging anything an
escalation, fetch the live grants** — `GET /api/admin/permissions` (the app's
admin-permissions endpoint) as ADMIN, or read the `role_permissions` table — and treat
THAT as the benchmark. A role reaching a capability the *live* table grants is correct
config, not a bug; only a divergence from **live** grants is a finding. (Skipping this
step turns every admin permission edit into a false P0 — the canonical matrix alone will
lie on any app whose permissions have been tuned.)

**Document the reconciled matrix in the report.** Record both inputs — the static
**code defaults** (`rbac-expected.json`) and the **live grants** fetched above — and the
**reconciled matrix** (static ∪ live overrides) you actually judged against. Without the
live-grants column in the report, a stale canonical matrix can silently hide permission
drift, so the reconciliation must be visible, not implicit.

This reconciled matrix is the source of truth. The live walkthrough's job is to
find every place the **running app disagrees with it** — in *either* direction:

- **Under-enforced (P0):** a role reaches something the (reconciled) matrix says it
  must not (privilege escalation / missing guard). The worst case.
- **Over-enforced (P1):** a role is blocked from something the matrix grants
  (broken feature / the user story can't be completed). Note that a route whose
  wrapper is `withAuth` but which gates *internally* on a capability/scope will read
  as "any authed" in the static matrix yet correctly 403 some roles live — confirm
  against the handler before filing it.

## Step 1 — discover the surface

Don't hardcode screens. Derive them the way `/uat` does — read the result of
`npm run manual-uat:matrix` (it lists sections + routes), or scan
`app/[locale]/(dashboard)/**/page.tsx` for the nav sections and
`prisma/schema.prisma` for the entities. Build a short plan: which sections, which
entities have full CRUD, which actions are sensitive (writes, deletes, role
changes, exports).

## Step 1b — build the coverage matrix (the completion contract)

The walk below is **checklist-driven, not exploratory** — that's what stops basic
cases slipping through (#1/#6). Before testing, enumerate every cell you owe; the
run is **not complete** until each has a verdict.

Build the matrix as the cartesian product:

> **entity × operation × role × track**
> where operation ∈ {create, read/list, edit, soft-delete (+ restore where it
> applies)}, role ∈ every role in the reconciled matrix, track ∈ {happy, worst}.

Plus two coverage axes the product alone misses:

- **Per-field validation variants** (the worst-path detail): for each writable
  field, at least one of each applicable — required-empty, boundary (max, max+1,
  min−1), wrong type, malformed format, duplicate-unique, injection-ish string.
- **Per-role field/data visibility:** for each entity, confirm fields that a role
  must not see are absent from BOTH the UI and the API response (not just hidden).

**Anchor on the blueprint.** If `docs/blueprints/<feature>.md` exists, every **user
story × role × {happy, worst}** is a required row — map stories onto the matrix so
the test proves the contract, not an arbitrary subset. No blueprint? Derive rows
from the discovered entities/routes and say so.

Track each cell's verdict (pass / fail / **N/A with a one-line reason** — never
N/A by omission). A cell left untested is an **incomplete run**, reported as such
in Step 6 — it does not silently read as a pass. Aim for 100% of non-N/A cells
exercised; report the exact coverage number.

## Step 2 — per role, walk happy then worst (the core loop)

For **each** role in the matrix (most-privileged first — ADMIN — down to the
least-trusted last, so you finish on the tightest boundary; capability forks have
their own roster, e.g. admin → pmo_manager → … → sales), via the Playwright MCP:

1. **Log in as the role** (use that role's env creds). Confirm you land on the
   dashboard and the nav shows exactly the sections the matrix grants this role —
   no more (a visible link to a forbidden section is a finding even if the click is
   blocked: it's a confusing dead end).

2. **Happy path per user story.** For each thing this role is *supposed* to do,
   actually do it with realistic data:
   - Create → confirm it appears in the list → edit → (soft-)delete → confirm it's
     gone (and recoverable in the recycling bin where applicable).
   - Tag created data with a `UAT —` prefix so it's identifiable and cleanable.
   - Watch the **feedback**: success states must be honest (no green toast over a
     500), loading states must show, the result must actually persist (reload and
     check).

3. **Worst path on the same flows.** Now try to break it as this role:
   - **Bad input at the boundary:** empty required fields, whitespace-only, max+1
     length, wrong type in a number field, malformed email, duplicate unique key,
     a `<script>`/`'; DROP`-style string, negative/zero where positive expected,
     far-future/past dates. Expect a **zod-backed message at the field**, not a
     crash, not a silent accept. Note any error that's generic, wrong, or missing.
   - **Flow abuse:** double-click submit, submit then back-button, deep-link
     straight to an edit URL for a record you shouldn't see, refresh mid-wizard.
   - **Authorization probes (the RBAC worst path):** as this role, try to reach
     every section + route the matrix says it must **not**, testing **BOTH** boundaries
     and recording each:
     - **UI navigation** — type the forbidden URL directly (not just the nav).
       **Success criterion: a guard redirect or a 403 page.** A rendered page is a
       failure.
     - **Direct API call** — hit the route's API directly (e.g. POST to an admin-only
       route). **Success criterion: 401 or 403.**
     A **2xx (a 200) on either probe is a P0 privilege escalation** — the worst case.
     Testing only the UI misses the API; this is what catches an EDITOR hitting an admin
     API the sidebar merely hides.

4. **Record as you go** (don't rely on memory): for every step, capture
   role · flow · track (happy/worst) · expected · actual · screenshot · verdict ·
   severity. Take a screenshot at each meaningful state (success, each distinct
   error, each blocked attempt) — they're the evidence.

## Step 3 — cross-role / user-story interaction

Single-role checks miss the interesting bugs. Explicitly test how roles interact:

- **Visibility of each other's data.** Does a record an EDITOR created show up
  correctly for a VIEWER / ADMIN? Are fields that should be hidden from a lower
  role actually hidden (not just visually, but not in the API response)?
- **Hand-offs.** ADMIN changes another user's role → does that user's access
  change as the matrix predicts on their next action? ADMIN soft-deletes a record →
  does it vanish for everyone and sit in the (admin-only) recycling bin?
- **User-story completeness.** For each stated user story, can the *intended* role
  complete it end-to-end, and is every *other* role correctly unable to? Frame each
  finding as "as a `<role>` I could/couldn't `<story>`, expected `<matrix says>`."

## Step 4 — monitor the actions (audit + console)

The app audits every create/update/delete automatically. As you act:

- Spot-check that your writes appear in the **audit log** with the right actor,
  and that Restricted fields are scrubbed (never plaintext) — the audit trail is
  part of "did the action really happen the way it claims."
- Watch the **browser console + network**: a flow that "succeeds" in the UI while
  throwing a console error or returning a 4xx/5xx on the wire is a finding, not a
  pass. Note every uncaught error with the step that produced it.

## Step 5 — UI/UX capture (the human-judgment pass)

Hold each screen to the UI Definition of Done (`docs/uat-rubric.md`). Call out, with
a screenshot + `file:line` where you can trace it:

- Real empty / loading / error states (or their absence).
- Honest feedback; no dead controls; one primary action per screen.
- Clear, correct, boundary-anchored validation copy.
- Responsive + **RTL** (`ar`) + dark-mode holds; obvious accessibility breaks.
- Confusing labels, surprising flows, mismatched mental models — the things only a
  human-style walkthrough surfaces.

## Step 6 — report

Write `uat-results/manual-uat-report.md` (gitignored, alongside the `/uat`
artifacts) and summarize in chat. Structure:

- **Verdict** — ready / not-ready to share, one line.
- **Coverage** — `<tested>/<total>` matrix cells exercised (and the list of any
  untested or N/A cells with reasons). Anything short of full non-N/A coverage
  makes the verdict **at best "not ready — incomplete"**; a confident "ready" needs
  the matrix actually walked, not sampled.
- **RBAC findings** — the live-vs-matrix diff: under-enforced (P0) first, then
  over-enforced (P1), then the matrix anomalies from Step 0. Cite role · route/section.
- **Worst-path findings** — crashes, silent accepts, wrong/missing validation,
  unsafe failures. P0/P1/P2 with the input that triggered them + screenshot.
- **Happy-path gaps** — user stories a role couldn't complete.
- **UI/UX findings** — prioritized, each with evidence.
- **Cross-role findings** — leaks, broken hand-offs.

Prioritize: **P0** broken/security-relevant (authz bypass, crash, data leak, silent
data loss) · **P1** incomplete (a user story that can't be finished, a missing
guard the matrix expects) · **P2** polish (copy, minor a11y, console noise).

### Report template (RBAC findings table)

```
## Verdict
NOT READY — 1 P0 privilege escalation.

## RBAC findings (live vs reconciled matrix)
| Sev | Role   | Route / capability        | Probe         | Expected      | Actual | Note                                  |
|-----|--------|---------------------------|---------------|---------------|--------|---------------------------------------|
| P0  | EDITOR | POST /api/admin/users     | direct API    | 403           | 200    | under-enforced: created an admin user |
| P1  | VIEWER | GET /reports (export btn) | UI nav        | visible+usable| 403    | over-enforced: matrix grants `report:read` |
```

(Under-enforced P0 = reached something the reconciled matrix forbids; over-enforced
P1 = blocked from something it grants. Cite role · route/capability · probe.)

## Boundaries

- **Runs and reports** — never edits app code in the same pass; fixes are a
  follow-up (then re-run to confirm).
- **Never hardcode creds or screens** — env creds, discovered surface.
- **Local/test DB only for provisioning + writes.** `manual-uat:users` refuses in
  production; point writes at a test/preview DB, never prod. Clean up `UAT —`
  tagged data (UI / recycling bin) when done.
- **Don't call it a pass if it couldn't run** — if the Playwright MCP or a role
  login couldn't be set up, say "could not run" and how to fix it, not "green."
- Artifacts (`uat-results/`) are gitignored — sessions, screenshots, the matrix,
  and the report stay out of git.
