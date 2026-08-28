# Chase notes — two messages you can send as-is

Both items below are blocked on someone else, and both have been blocked for a while. Each note is
written to be **copied and sent without editing** — it names what is needed, what it unblocks, and
what happens if it doesn't arrive. Neither asks the recipient to understand the project first.

---

## 1 — To IT: three environment variables

> **Subject: Three env vars needed for the performance system (5 minutes)**
>
> Hi — the performance management system is deployed and working, but two features are switched off
> until three sets of environment variables are set in Vercel. Both are already built and tested;
> nothing needs writing.
>
> **1. Email notifications — `SMTP_HOST` (plus the usual user/password/port).**
> Without it the app runs normally but sends nothing. That affects the rater invitations and the
> deadline reminders in the performance cycle — the people who need to act don't get told to.
>
> **2. Single sign-on — `AUTH_ENTRA_ID`, `AUTH_ENTRA_SECRET`, `AUTH_ENTRA_TENANT_ID`.**
> Right now everyone needs a password we set by hand. With these, staff sign in with their normal
> work account and we stop managing passwords entirely.
>
> **3. The group claim for SSO — which Entra group should map to platform administrator.**
> We need the group _name as Entra emits it_, and it goes in `SSO_ADMIN_GROUPS`. Anyone not in a
> listed group gets ordinary access, which is the safe default — so a wrong or missing value means
> too little access, never too much.
>
> One note on the third: please **don't** set `SSO_EDITOR_GROUPS`. It used to map to an "editor"
> role that we've since removed because it granted nothing; the variable is now ignored.
>
> Happy to walk through any of it. The only thing we can't do at our end is set them.

---

## 2 — To Rihal HR: three questions about the specification

> **Subject: Three questions on the performance spec — they change what we build**
>
> Hi — as we've built the performance system, three points in the specification turned out to have
> more than one reasonable reading. We've made a working assumption on each so nothing is blocked,
> but each one changes real behaviour, so we'd rather you decided than us.
>
> They're written up here, one page, with the clause and what each answer would mean:
> **`docs/verification/OPEN-QUESTIONS-FOR-RIHAL.md`**
>
> They're genuinely questions for you, not for engineering — each is a policy choice about how the
> cycle should work, and no amount of building settles them.
>
> If it's easier to talk them through than to write answers, that works too — fifteen minutes would
> cover all three.

---

## Why chase these now

Both are **cheap for the other person and blocking for us**, which is the combination that gets
forgotten. The engineering for both is finished and sitting idle:

| Held by  | What's blocked        | State of our side                                                                            |
| -------- | --------------------- | -------------------------------------------------------------------------------------------- |
| IT       | Email notifications   | Built, tested, dormant behind `SMTP_HOST`                                                    |
| IT       | Single sign-on        | Built, tested; the role mapping has contract tests                                           |
| Rihal HR | Three spec behaviours | Assumptions in place and documented — changeable cheaply now, expensive after the cycle runs |

The HR one has a deadline that isn't obvious: once a real performance cycle has run under the
current assumptions, changing them means migrating data that people have already acted on. Before
the first live cycle it's a config decision; after it, it's a data-migration project.
