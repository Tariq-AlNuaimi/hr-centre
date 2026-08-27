# Demo cast — who signs in, for which flow, and how

**For:** the stakeholder demo · **Fixture:** `prisma/seed-pms.ts` + `prisma/seed-demo-cycle.ts`
**Decision this implements:** operator, 2026-08-26 — set passwords for four or five people rather
than configuring the corporate IdP before the demo.

## Why this sheet exists

Applying an employee import now provisions a **passwordless** login for every employee (ADR-069), and
the seeded fixture does the same. Passwordless is deliberate: `authorize()` refuses an account with no
hash, so nobody can guess their way in. It also means that **until an IdP is configured, none of those
accounts can be signed into** — which is correct for thirty-six people and unhelpful for the five who
have to appear on stage.

So the demo cast get real passwords, created deliberately, one at a time, by a platform admin. Five
accounts, not thirty-six: a shared password sprayed across the whole fixture is the one thing the
provisioning design exists to avoid.

## The cast

Five people. Each one is on stage because a **different clause** needs a different pair of eyes — this
is not five HR logins with different names, which is exactly what the previous conformance report was
criticised for.

| #   | Person              | Odoo ID | Email                          | Their authority                | What they demonstrate                                                                                                                                          |
| --- | ------------------- | ------- | ------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Fatma Al-Rashdi** | `1100`  | `fatma.alrashdi@rihal.example` | `HR_SUPER_ADMIN`, Director     | §5.1's approval — the lock that opens §7→§13. §10 calibration. §13.2's publish. The import.                                                                    |
| 2   | **Layla Al-Habsi**  | `1202`  | `layla.alhabsi@rihal.example`  | Line manager (Lead, 2 reports) | §5.2's six KPI texts, §5.3's sign, §7's manager rating, §13.3's team roster. Also a 360 rater.                                                                 |
| 3   | **Omar Al-Busaidi** | `1203`  | `omar.albusaidi@rihal.example` | Ordinary employee              | §5.3's "exactly 100% to sign", §7's self-assessment, §13.1's scorecard and §13.2's publish gate from the employee's side.                                      |
| 4   | **Tariq Al-Naaimi** | `1200`  | `tariq.alnaaimi@rihal.example` | Director, 2 reports            | §9.7's 360 execution — he has **unanswered assignments waiting** in the fixture, so the form can be filled in live. §4.2's chain visibility, four levels deep. |
| 5   | **Yousuf Al-Amri**  | `1101`  | `yousuf.alamri@rihal.example`  | `HRBP`                         | §4.1's hardest line: refused calibration and the master export, while keeping org-wide sight. The refusal is a sentence, not a blank screen.                   |

**If you can only do three:** Fatma, Layla, Omar. That covers §5 end to end, §7 both sides, and §13's
publish gate. Tariq adds the 360; Yousuf adds the permission story.

## Setting each password

### The one-command path

`scripts/provision-logins.mjs --demo-cast` does all five in one go. It reads one password per
person from the environment, hashes them with the app's own function, links each account to its
employee record, and stamps `passwordChangedAt` so any session issued earlier is torn down.

```bash
export DEMO_PASSWORD_1100=…   # Fatma
export DEMO_PASSWORD_1101=…   # Yousuf
export DEMO_PASSWORD_1200=…   # Tariq
export DEMO_PASSWORD_1202=…   # Layla
export DEMO_PASSWORD_1203=…   # Omar

DATABASE_URL=… npm run demo-cast              # dry run — shows the five, writes nothing
DATABASE_URL=… npm run demo-cast -- --apply   # sets the passwords
```

It refuses to run unless **all five** are supplied, so a half-provisioned cast is never the thing
discovered on stage, and it refuses to touch anybody who is not on the list. It generates nothing
and prints nothing: a password this script invented would have to be transmitted somehow, and every
way of doing that is worse than choosing five yourself.

While you are there, `npm run provision-logins -- --apply` gives **every** active employee the
passwordless login ADR-069 says they should have. Production's database was seeded before that
behaviour existed, so its employees have none; the script is idempotent, skips leavers, and skips
any email that already has an account.

### The by-hand path

Sign in as the bootstrap admin, then for each person above:

1. Go to **`/users/new`**.
2. Enter their **email exactly as written in the table** — lower case, no trailing space. This is what
   links the login to the employee record: `resolveActor` matches on it.
3. Set **Role** to `VIEWER`. This is the platform role, not their HR authority — §4.1's authority comes
   from `Employee.pmsRoles` and is already on the fixture record. Making them an ADMIN here would give
   them the users list, the recycling bin and the audit log, which is not what any of them are demoing.
4. Choose a password. **One per person, not one shared across the five.**
5. Save, then confirm at **`/admin/roles`** that their row now reads **Can sign in → Has login**.

> **If the email is already listed at `/users`** the account exists; use the password reset on that
> user rather than creating a second one. A duplicate email is refused by the unique index, and the
> refusal is the system working.

## Before the demo — check these four, in this order

Each one is a state the fixture was built to hold, and each is a thing that can drift if the database
has been poked at.

| Check                                           | Where                    | What you should see                                                                         |
| ----------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| A roster is still **unsigned**                  | `/goal-setting` as Fatma | At least one participant awaiting approval, so §5.1's approve panel has something to act on |
| The 360 is still **ACTIVE** with an open window | `/three-sixty` as Fatma  | Status ACTIVE, deadline in the future                                                       |
| Tariq still has an **unanswered** assignment    | `/` (My Tasks) as Tariq  | A "360 assessment of …" card with a lock date                                               |
| Results are **not yet published**               | `/scorecard` as Omar     | "Results are not out yet" — so publishing it live is a real transition, not a no-op         |

If the last one already reads as published, publishing on stage shows nothing. Un-publishing is
available to an HR Super Admin at `/calibration` and is audited, which is itself worth showing.

## Two things to say out loud rather than let someone find

- **Email is not sent.** §5.5's reminders and §9.7's invitations need an SMTP provider, which is the
  one outstanding deliverable. The compliance record is written either way, so today's behaviour is
  "the log is right, nobody was told." Set the five `SMTP_*` variables and it starts sending; no code
  changes.
- **These five passwords are a demo scaffold, not the plan.** The real path is the corporate IdP:
  set `AUTH_ENTRA_ID`, `AUTH_ENTRA_SECRET` and `AUTH_ENTRA_TENANT_ID` and every provisioned employee
  can sign in with their Rihal identity, with no password anywhere. Deleting these five accounts
  afterwards costs nothing — the employee records are untouched by it.
