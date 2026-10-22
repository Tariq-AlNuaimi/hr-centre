# Runbook — reset the test dataset

For **Tariq** to run; the preview goes to **Muna** to approve. Four steps, and nothing is
changed until step 4.

> **What this does.** Moves every test person, department and entity to the Recycling Bin
> (reversible), **permanently deletes every performance cycle** and everything attached to it
> (not reversible), then creates 2 entities, 3 departments, 24 people with full reporting lines,
> and one fresh cycle with all three stages open.
>
> **Kept:** anyone who can sign in today, anyone with an HR or admin role, plus Muna Adam and
> Tariq Al-Naaimi. **Logins are never deleted** — removing a person does not remove their account,
> so nobody is locked out. **The audit log is never touched.**

---

## Step 1 — get the database connection

You need the production `DATABASE_URL`. It is a password, so treat it like one.

1. Open **vercel.com** → the `rihal-performance-management` project → **Settings** →
   **Environment Variables**.
2. Find **`DATABASE_URL`** and copy its value. Do the same for **`SALARY_ENCRYPTION_KEY`**.

Then in a terminal, in a checkout of this repo on the `main` branch:

```bash
git pull
npm install
```

Now set the two values. **Type a space before each `export`** — with a leading space, bash keeps
the line out of your shell history:

```bash
 export DATABASE_URL='paste-the-value-here'
 export SALARY_ENCRYPTION_KEY='paste-the-value-here'
```

`SALARY_ENCRYPTION_KEY` must be the **production** one. The new people's salaries are encrypted
with it, and a different key would make them unreadable in the app.

Two things not to do: don't put these in a file (`.env` is never committed and `gitleaks` blocks it
anyway), and don't paste the connection string into chat, a ticket or an email.

---

## Step 2 — arm the tool

```bash
export DUMMY_DATA_RESET=yes-wipe-and-reseed
```

This is one of five guards. The others are already in place: the tool is a command line only and
can't be reached from the app, `project.config.json` carries `dummyData.resetAllowed`, it refuses
outright if any cycle has published results, and the real run needs a typed count.

---

## Step 3 — the dry run (changes nothing)

```bash
npm run db:dummy-data
```

It prints four sections:

- **PEOPLE WHO STAY** — each with the reason they were kept
- **PEOPLE WHO GO** — to the Recycling Bin, restorable
- **DEPARTMENTS / ENTITIES WHO GO** — also restorable
- **CYCLES REMOVED PERMANENTLY** — each cycle with a count of everything that goes with it
  (participants, KPIs, ratings, signatures, evidence, scores, 360 assignments and responses,
  Strategy scores)

The last line tells you the exact apply command, including the number to confirm.

**Send Muna the whole output.** The simplest way is to save it and attach the file:

```bash
npm run db:dummy-data > preview.txt 2>&1
```

Then send `preview.txt`. It contains no passwords and no connection string.

**Wait for her approval before step 4.**

---

## Step 4 — apply (this is the real one)

Use the exact command the dry run printed. The number is not decoration — it is re-checked against
the database, so if anything changed since the preview the run stops:

```bash
npm run db:dummy-data -- --apply --confirm 44
```

It prints what it removed and created, then **five logins, once**:

```
  C_LEVEL / DIRECTOR / MANAGER / LEAD / INDIVIDUAL
    name / email / password
```

**Copy those five immediately.** They are generated fresh each run, stored only as a hash, and
never written to a file or to git — re-running the tool makes new ones. Send them to Muna however
you normally share a credential, not in plain chat.

Everyone else is passwordless, exactly as an imported population is, and the HR and admin accounts
you kept keep their own passwords.

---

## If it refuses

The tool prints the plan first and the reason second, so you always see what it _would_ have done.

| It says                                           | What to do                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `DUMMY_DATA_RESET must be set to exactly …`       | Step 2.                                                                                                 |
| `project.config.json does not set … resetAllowed` | The flag is off. It is off deliberately once the system goes live — ask Muna before turning it back on. |
| `cycle N has PUBLISHED results`                   | Results have been released to people. Un-publish that cycle in the app first, by hand and deliberately. |
| `--confirm N does not match`                      | The data changed since the preview. Re-run step 3 and read it again.                                    |
| `nothing in the keep list is an HR Super Admin …` | Applying would lock everyone out of running a cycle. Give someone an HR role in the app, then re-run.   |
| `DATABASE_URL is not set`                         | Step 1.                                                                                                 |

## Re-running it later

Safe and designed for it. Run steps 3 and 4 again whenever the test data gets messy. The people it
created last time are removed permanently (they are the tool's own rows, inside a reserved
`DUMMY-` namespace, never anybody's real record) and a clean set is built again.

## Undoing it

**People, departments and entities:** sign in as an HR admin → **Recycling Bin** → restore. One row
at a time; there is no bulk restore.

**Cycles:** not recoverable. They do not go to the Recycling Bin, which is why the dry run prints
their contents and why Muna approves before step 4.

## What you get

- 2 entities, 3 departments — Engineering 9, Delivery 6, Operations 7, so every department is big
  enough for the calibration curve
- 24 people: 2 C-Level (no manager, by design), 2 Directors, 3 Managers, 3 Leads, 14 Individuals
- Everyone except C-Level has a manager, and everyone has their manager plus at least two
  same-department peers available as 360 raters
- Four edge cases: a new joiner inside 6 months, someone with 30 unpaid-leave days, a mid-cycle
  transfer between departments, and a leaver
- One cycle with goal-setting, mid-year and year-end **all open at once**, so you can walk the
  stages in any order without waiting for a window or hitting a deadline lock

The leaver is deliberately **not** enrolled in the cycle — the system excludes leavers from
enrolment (§12.1), so expect 23 of the 24 plus your kept HR people as participants.

What it does **not** create, on purpose: the Corporate and Departmental scores, and the 360 cycle.
Those are HR's own steps in the app (Admin → Corporate & departmental scores, and the 360 screen),
and seeding them would hide the steps this dataset exists to let you exercise.
