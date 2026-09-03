# What this system has that the specification did not ask for

**For IT, at handoff.** Fold this into `HANDOFF.md` when the handoff package is produced —
`/handoff` does not run at this project's `personal` tier, so it lives here until it does.

Everything in §1–§14 and Appendix A of the PMS Functional Specification is built; that is tracked in
[`SPEC-CONFORMANCE.md`](SPEC-CONFORMANCE.md). This page is the other direction: the things the
system carries that **no clause asked for**.

They are here on purpose, and the reason matters for whoever owns this next: **a specification
describes a process, not an application.** §1–§14 describe how Rihal runs a performance year. They
say nothing about how a person signs in, what happens when HR deletes the wrong employee, or who is
told when nobody is watching. Those questions do not go away because the spec is silent on them —
they get answered by whoever builds it, well or badly.

So none of the below is scope creep, and none is optional. Removing any of it does not return the
system to spec; it returns it to a spec-shaped process with no way to operate it.

---

## 1 · Single sign-on (Microsoft Entra)

**What.** Staff sign in with their normal work account instead of a password this system sets.
`lib/sso/role-map.ts` maps an Entra group to platform administrator; anyone in no listed group gets
ordinary access.

**Why it is not optional.** §3.3 lists email as the field used "for login/notifications" and stops
there. The alternative to SSO is this application storing a second password for every employee in
the company — a credential set to rotate, reset, leak and support, parallel to the one IT already
runs. That is a security liability the spec neither asked for nor forbade.

**State.** Built and contract-tested; **dormant** until IT sets `AUTH_ENTRA_ID`,
`AUTH_ENTRA_SECRET`, `AUTH_ENTRA_TENANT_ID` and the group claim in `SSO_ADMIN_GROUPS`. Until then
password login is the only door. A wrong or missing group value grants **too little** access, never
too much — the safe direction. Do **not** set `SSO_EDITOR_GROUPS`; the role it mapped to was removed
(ADR-070) and the variable is ignored.

**Reading:** ADR-069, `docs/verification/CHASE-NOTES.md`.

## 2 · Soft delete and the recycling bin

**What.** Deleting an employee, user, department, org entity or KPI marks it deleted and hides it
from every query; `/recycling-bin` restores it. A retention cron eventually purges.

**Why it is not optional.** §12.1 off-boards a leaver and §3 has HR maintaining the org tree — both
are destructive operations on data that other people's performance records point at. A hard delete
of an employee mid-cycle takes their KPIs, ratings, signatures and compliance events with it, and
§11's reporting can never be made whole again. The spec does not discuss deletion at all, which is
precisely why the default had to be reversible.

**Operational note.** `prisma.employee.delete` is rewritten to an UPDATE by the soft-delete
extension, so a foreign key's `ON DELETE CASCADE` never fires on an ordinary delete. That is
intended — a restored person comes back with their history — but it surprises people reading the
schema. Asserted in `tests/integration/pms-notifications.test.ts` so it stays a decision.

**Reading:** `lib/prisma/soft-delete-extension.ts`, `docs/rules/prisma.md`.

## 3 · One access screen, and a platform role that is a yes/no

**What.** `/admin/access` is the single place logins and HR authority are managed. The platform role
is a **checkbox** — platform administrator, or not.

**Why it is not optional.** §4.1–§4.3 define HR authority (`Employee.pmsRoles`, additive, "most
access wins"). Nothing in the spec describes who may administer the _application_, so the template's
three-value role (Admin / Editor / Viewer) sat alongside it — two role systems on one screen, one of
them meaningless. `EDITOR` granted nothing: no route in this application ever admitted it. A
decorative middle value in an access screen is how someone eventually grants the wrong thing.

**What IT should know.** `User.role` (platform) and `Employee.pmsRoles` (HR authority) are
deliberately **separate axes**, and a platform admin is not thereby an HR administrator — though
they control credentials, so they can become one by acting. ADR-065 states that plainly rather than
pretending otherwise.

**Reading:** ADR-065, ADR-070, and `ADR-070-rollback-note.md` (the enum change is not reversible by
`git revert`).

## 4 · In-app notifications

**What.** A notifications bell, and a "New notices" block on the dashboard, fed by the daily cycle
sweep (`/api/internal/cycle-sweep`, 06:00 UTC).

**Why it is not optional.** §5.5's escalation ladder exists to reach a human — a manager approaching
a deadline, then the skip-level manager who has "authority to compel action", then HR. The spec
assumes email. This deployment has no SMTP, and until 2026-08-28 the sweep wrote §5.6's compliance
record faithfully and told **nobody**. The skip-level manager in particular has no task row to
discover it through: it is not their set to draft.

**What IT should know.** Email is now the _second_ channel, not the only one. Setting `SMTP_HOST`
turns it on and changes nothing else. The two channels are computed from one recipient map, so they
cannot disagree.

**Open item for you:** nothing purges notifications. The audit-purge cron has a retention window;
this does not. Left deliberately rather than guessing a window before anyone had used the feed — a
first cycle's volume is a few hundred rows. **Choose one once you have seen real volume**, and
extend the existing purge cron rather than adding a second. Deleting a notification does not touch
the §5.6 compliance record, which is the durable one.

**Reading:** `docs/blueprints/in-app-notifications.md`.

## 5 · Two things that answer §-level questions rather than adding surface

Listed separately because they are not features — they are places the spec was ambiguous and the
answer had to live somewhere.

- **Cycle policy** (`/admin/cycles` → Policy). §6.2, §7.1 and §8.7 each admit more than one reading.
  Rather than freeze the build's guess, each is a setting HR sets per cycle while it is a draft.
  Defaults reproduce the previous behaviour exactly. See
  [`OPEN-QUESTIONS-FOR-RIHAL.md`](OPEN-QUESTIONS-FOR-RIHAL.md) — **still unanswered**, and worth
  chasing before the first live cycle.
- **Salary encrypted at rest** (ADR-067). §4.5 and §11.6 restrict basic salary to HR and the
  COO/Ops Director. Storing the most tightly held field in the system in plaintext would have made
  that access control the only thing standing between a database backup and every salary at Rihal.
  Requires `SALARY_ENCRYPTION_KEY`; the application cannot read or write salary without it.

---

## The one-line version, if someone asks why any of it is there

The specification describes a **process**. An application that runs that process also has to answer
how people get in, what happens when something is deleted by mistake, who is told when no one is
watching, and where the most sensitive number in the system lives. §1–§14 answer none of those, and
the answers are not optional — only whether they are deliberate.
