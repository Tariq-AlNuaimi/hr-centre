# Demo-day runbook — the exact sequence, in order

**Companion to [`DEMO-CAST.md`](DEMO-CAST.md).** That sheet says _who_ signs in and _why_. This one
is the mechanical sequence: what to run, what it should print, and what to do when it doesn't.

Written to be followed literally, under time pressure, without reconstructing anything. If a step's
output doesn't match what's written here, stop at that step — the later ones assume it worked.

> **Everything here runs against PRODUCTION.** Claude could not run any of it: production database
> access is blocked for the agent session by design, and that block was deliberately not worked
> around. So these commands have been read and reasoned about but **not executed end-to-end against
> the live database** — treat the first run as the real test, and leave yourself more than five
> minutes for it.

---

## Step 0 — Confirm what is deployed (30 seconds)

```bash
curl -s https://rihal-performance-management.vercel.app/api/health
```

**Expect:** `{"status":"ok","checks":{"db":"ok","timestamp":...}}`

`db: ok` is the part that matters — it proves the app can reach Neon, which every later step needs.
If this fails, nothing below will work; check the Vercel deployment before going further.

---

## Step 1 — The thing nobody has verified yet (2 minutes)

**Do this first, before any data changes.** `/admin/access` has never been exercised against
production — only locally. This is the one gap in an otherwise verified change.

1. Sign in at `https://rihal-performance-management.vercel.app` as the bootstrap admin.
2. Go to **`/en/admin/access`** (or click **Access** in the sidebar).
3. Check three things:
   - Two sections render: **Logins & platform administration** and **HR authority**.
   - The accounts table lists real accounts, each showing **Platform admin** or **Standard**.
   - Click **Create login** — the form shows a **Platform administrator checkbox**, not a role
     dropdown with Admin/Editor/Viewer.
4. Visit **`/en/users`** in the address bar. It should **redirect** to `/en/admin/access`.

**If the create form still shows a dropdown**, the deployment is older than `725cbde` — check
Vercel's latest production deployment before doing anything else.

---

## Step 2 — Provision the logins (5 minutes)

Gives every active employee an account. Idempotent: safe to re-run, and it never touches an account
that already exists.

```bash
# DRY RUN FIRST. It changes nothing and prints what it would do.
npm run provision-logins

# Then, once the count looks right:
npm run provision-logins -- --apply
```

**Expect:** a count of accounts created, and a closing line noting that none of them can be signed
into yet (they are provisioned **passwordless** on purpose — see below).

**Why passwordless:** an account with no password hash cannot be signed into at all, which is safer
than generating a random password nobody is ever told. Those people get in via SSO once IT sets
`AUTH_ENTRA_*`, or via a password you set by hand in step 3.

**If the count is 0** and you expected more: the employees may already be provisioned from a previous
run — check the accounts table on `/admin/access` before assuming something is broken.

---

## Step 3 — Set the five demo passwords (5 minutes)

The five people in `DEMO-CAST.md` need real passwords, because they will actually sign in.

```bash
# One env var per person, keyed by their Odoo id. Use a different password each.
export DEMO_PASSWORD_1100='…'
export DEMO_PASSWORD_1101='…'
export DEMO_PASSWORD_1102='…'
export DEMO_PASSWORD_1103='…'
export DEMO_PASSWORD_1104='…'

npm run demo-cast            # dry run — prints who it would set, never the values
npm run demo-cast -- --apply
```

Check the Odoo ids in `DEMO-CAST.md` against the table there; the ids above are the shape, not
necessarily the values.

**Three rules, and they are not ceremony:**

- **One password per person, never one shared across five.** If they share one, the permission demo
  proves nothing — anyone can be anyone.
- **Never paste a password into chat, a ticket, or a shared doc.** The script reads them from the
  environment precisely so they never have to be written down.
- **Clear them afterwards:** `unset DEMO_PASSWORD_1100 …` — or just close the terminal.

**If a person is skipped:** they had no account. Run step 2 first, then re-run this.

---

## Step 4 — The four fixture checks (5 minutes)

These are the states the demo actually shows. Each has been correct locally; confirm on production.

| #   | Check                               | Where                                     | What "right" looks like                                    |
| --- | ----------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| 1   | HR roles are on the right people    | `/admin/access` → HR authority            | The HR Super Admin and HRBP rows show their badges         |
| 2   | Everyone can sign in                | same table, **Can sign in** column        | Green **Has login** — not "No login", not "Access revoked" |
| 3   | A scorecard has real numbers        | `/scorecard` as a cast member             | A band and a score, no empty state                         |
| 4   | 360 comments are withheld correctly | a ratee with fewer than 2 submitted forms | The withheld notice, not blank, and not the comments       |

**On #2**, the three states mean different things and have different fixes:

- **No login** → run step 2.
- **Access revoked** → that person was off-boarded. Restore from the **recycling bin**; do _not_
  create a second account (the unique email index will refuse it, correctly).

---

## Step 5 — Sign in as each cast member (5 minutes)

Once each, in a **private window** so sessions don't collide. Confirm each lands on the screen
`DEMO-CAST.md` says they should, and that the sidebar shows only what their role should see.

This is where a wrong password or a missing HR role surfaces — much better now than mid-demo.

---

## If something breaks during the demo

- **Someone can't sign in.** Don't debug live. Move to the next person; you have five.
- **A screen is empty.** Say what it means — "no data yet for this cycle" is a real state the system
  is meant to show, not a failure. It is honest and it is in the design.
- **A number looks wrong.** Note it, move on. Don't recompute in front of the room.
- **The app is down.** `curl` step 0. If `db: ok` fails it is Neon, not the app, and not something
  you can fix in the moment.

## What is NOT ready, if asked

Say these plainly rather than let someone discover them:

- **Email is not sending.** SMTP is unconfigured — IT holds those variables. Notifications are built
  and will work the moment it is set.
- **SSO is not live.** The seam is built and tested; it needs `AUTH_ENTRA_ID`, `AUTH_ENTRA_SECRET`,
  `AUTH_ENTRA_TENANT_ID` and the group claims from IT.
- **Three spec questions are open.** They are in
  [`../verification/OPEN-QUESTIONS-FOR-RIHAL.md`](../verification/OPEN-QUESTIONS-FOR-RIHAL.md) — they
  need HR's answers, not more engineering.
