---
name: quickstart
description: Turn one paragraph of an idea into a live URL the operator can share with their team in ~10 minutes. Combines /scaffold-entity for the data model with a guided commit + push so Vercel deploys the result. Use when the user says "I have an idea for X", "start a tracker for ...", "new feature: ...", "quickstart", "/quickstart", or pastes a sketch / screenshot from their team describing what to build.
---

# /quickstart — Idea → live URL

The fastest path from "I want to test this idea with my team" to a sharable
URL. Optimized for non-developer stakeholders: they see a URL, click around,
send a screenshot back, you iterate with Claude, repeat until approved.

## When to use

- User pasted a paragraph describing what they want.
- User showed a screenshot or sketch from their team.
- User said "new project" / "new feature" / "let's prototype X".

## Preconditions

- `/first-fork` has been run (Vercel + Neon are connected).
- The local repo is up to date with `main`.

## Steps

### 1. Parse the idea into entities

Read the user's prompt and propose a short entity model. Examples:

| Prompt | Proposed entities |
|---|---|
| "Track support cases" | `Case { title, description, status, assignee, dueDate }` |
| "Asset register for IT" | `Asset { name, serial, owner, location, status }`, `MaintenanceLog { asset, date, note, performedBy }` |
| "Vacation requests" | `VacationRequest { requester, startDate, endDate, reason, status, approver }` |

**Confirm with the user before scaffolding.** Show:
- Entity list with a 1-line purpose each.
- Field list per entity with types.
- Any enums or relations.
- Ask: "Does this match what you had in mind? Anything to add / remove?"

Keep it minimal. Bias toward 1–3 entities for the first iteration; the
operator will say "now add X" in follow-ups.

### 2. Scaffold

For each entity, run `/scaffold-entity` (or the underlying script):

```sh
npm run scaffold -- --name <Entity> \
  --fields '<field>:<type>,<field>:<type>?' \
  [--enums '<field>:OPT_A|OPT_B'] \
  [--relations '<field>:<TargetEntity>?']
```

After each scaffold:

```sh
npx prisma generate
npx prisma migrate dev --name add_<entity>
```

(Local Postgres must be up: `make db-up` if not.)

### 3. Quick smoke

```sh
npm run dev
```

Open `http://localhost:3000`, log in with the seed credentials, navigate to
the new entity's page, create one row. If it works locally, push.

### 4. Push

```sh
git add -A
git commit -m "feat: scaffold <entity-list> for <one-line-purpose>"
git push
```

Vercel auto-builds (~90s). If the user has set up branch previews, a push to
a non-main branch produces a preview URL; a push to `main` updates production.

### 5. Apply the migration to Neon

Production uses Neon. The build command runs `prisma migrate deploy` on every
Vercel build, so the migration applied in step 2 will run on the next deploy
automatically. **No manual step needed.**

### 6. Hand the URL to the team

Print the production URL (or preview URL). Examples of useful follow-up
prompts you can suggest to the operator:

- "When your team has feedback, paste their screenshot here and tell me
  what to change."
- "Next iteration is one prompt away."

## Common follow-up patterns

| User says | What to do |
|---|---|
| Pastes a screenshot with a red circle on a button | Find the component, change the label / styling, commit, push |
| "Add a status field with these values: …" | Add to the Prisma enum, run `prisma migrate dev`, push |
| "This page is missing the assignee" | Add the field + relation, scaffold a select on the form, push |
| "The team wants Excel export" | Use `lib/export.ts` -- `toExcel(rows, columns)` already wired; add a route + button |
| "It's slow" | Check `lib/prisma/*` for missing indexes; add `@@index` to the model |

## Skip when

- The user is asking about an existing feature (not a new one).
- The user is asking for production-grade changes (use `/scale-up` instead).
- The user wants to deliver to IT (use `/handoff`).
