# Recipe: `can(user, action, resource)` — per-resource / row-level authorization

> **This fork (ADR-070):** `withEditorAuth` and the `EDITOR` role no longer exist here — the wrapper
> gated nothing and was removed with the enum value. Use `withAdminAuth` or `withAuth`; a route
> naming `withEditorAuth` fails both typecheck and the `no-bare-api-route` ESLint rule.

> `/scale-up` → shared-tier security checklist supplement **O12**.
> Adds a fine-grained permission helper **on top of** the role wrappers
> (`withAuth` / `withEditorAuth` / `withAdminAuth`) for rules the role gate can't
> express — e.g. _"an EDITOR may edit only the records they own."_

## The gap this fills

The shipped wrappers in `lib/api-helpers.ts` answer **"what role is this user?"**:

- `withAuth` — any authenticated user.
- `withEditorAuth` — ADMIN or EDITOR (rejects VIEWER).
- `withAdminAuth` — ADMIN only.

They do **not** answer **"may this specific user act on _this specific_ row?"** —
that's per-resource / row-level authorization. `SECURITY.md` §3 already names this
as project-specific: _"Row-level scoping (e.g. 'users only see their own records')
is project-specific. Add an explicit `WHERE` clause in every list/get query"_ and
_"Finer-grained, per-resource permissions (a `can()` helper) remain a project-specific
addition."_ This recipe is that helper.

The wrappers and `can()` **compose**: the wrapper is the coarse gate (role), `can()`
is the fine gate (this row). You run `can()` _inside_ an already-role-gated handler —
it never replaces the wrapper.

## When to add it

Add this when a fork has **ownership or assignment semantics** that the three roles
don't capture:

- "EDITOR can edit/delete only records they created" (the canonical case).
- "A user sees only projects they're a member of."
- "Only the assignee or an ADMIN can close a ticket."

**Don't** add it for a flat model where the role _is_ the whole authorization story
(the shipped template: ADMIN manages users, everyone else reads). Adding a policy
map there is ceremony with no rule to express.

> This is a `shared`-tier-flavored addition (it's about provable, per-row access
> control), but it's cheap and dependency-free, so a `personal` fork with ownership
> semantics can use it too. It is **not** one of the six §16 floor items — it's a
> supplement, surfaced here because §3 points at it.

## Deps

None. Pure TypeScript + the `Role` enum already in `@/generated/prisma/client`.

## The policy map — `lib/permissions.ts`

```ts
// lib/permissions.ts
// Per-resource / row-level authorization, layered ON TOP of the role wrappers in
// lib/api-helpers.ts. The wrapper answers "what role?"; can() answers "may THIS
// user act on THIS row?". See SECURITY.md §3 (row-level scoping is project-specific).
import type { Role } from "@/generated/prisma/client";

// The acting user — exactly the shape carried on session.user (id + role). Never
// cast session to `any` to get this (CLAUDE.md hard rule / no-any-cast-on-session).
export interface Actor {
  id: string;
  role: Role;
}

// The minimum a resource must expose to be checked: who owns it. Widen per model
// (e.g. add `members: string[]` or `assigneeId`) as your rules need.
export interface Ownable {
  ownerId?: string | null;
}

export type Action = "read" | "create" | "update" | "delete";

// A policy returns true if the actor may perform `action` on `resource`.
// `resource` is undefined for collection-level / create checks (no row yet).
type Policy<R extends Ownable> = (actor: Actor, resource?: R) => boolean;

// Reusable predicates.
const isAdmin = (a: Actor) => a.role === "ADMIN";
const isOwner = <R extends Ownable>(a: Actor, r?: R) => !!r && !!r.ownerId && r.ownerId === a.id;

// Policy map keyed by resource type, then action. ADMIN is the escape hatch on most
// actions; EDITOR is constrained to their own rows; VIEWER reads only.
// Add a block per audited entity that has ownership semantics.
export const policies: Record<string, Partial<Record<Action, Policy<Ownable>>>> = {
  Project: {
    read: () => true, // any authenticated user may read (tighten if needed)
    create: (a) => a.role === "ADMIN" || a.role === "EDITOR",
    // EDITOR edits only their own; ADMIN edits any.
    update: (a, r) => isAdmin(a) || (a.role === "EDITOR" && isOwner(a, r)),
    delete: (a, r) => isAdmin(a) || (a.role === "EDITOR" && isOwner(a, r)),
  },
  // Example: a stricter resource only ADMIN and the assignee can close.
  // Ticket: {
  //   update: (a, r) => isAdmin(a) || (!!r && (r as any).assigneeId === a.id),
  // },
};

/**
 * Returns true iff `actor` may perform `action` on `resource` of type `type`.
 * Default-deny: an unknown type or unlisted action returns false. `resource` is
 * omitted for create / collection checks (there's no row yet).
 */
export function can<R extends Ownable>(
  actor: Actor,
  action: Action,
  type: string,
  resource?: R,
): boolean {
  const policy = policies[type]?.[action];
  if (!policy) return false; // default-deny
  return policy(actor, resource);
}
```

> **Default-deny is deliberate.** If a resource type or action isn't in the map,
> `can()` returns `false` — the safe failure mode. A new audited entity is _denied_
> until you add its policy, which is the behavior you want for a security gate.

## Using it inside a route (after the wrapper)

`can()` runs **inside** an already-role-gated handler. The wrapper rejects the wrong
_role_ (cheap, no DB hit); `can()` then rejects the wrong _row_ after you've fetched
it. The acting user comes from `ctx.session.user` — already typed as `{ id, role:
Role }` via the augmentation in `types/index.ts` (never cast `session` to `any`).

```ts
// app/api/projects/[id]/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withEditorAuth } from "@/lib/api-helpers";
import { ok, err, forbidden, notFound } from "@/lib/api-response";
import { can } from "@/lib/permissions";
import { updateProjectSchema } from "@/lib/validations/project";

// withEditorAuth: coarse gate — ADMIN or EDITOR only (VIEWER already 403'd here).
export const PUT = withEditorAuth(async (req: NextRequest, { params, session }) => {
  const { id } = await params;

  // Fetch the row first — row-level checks need the resource (here, its ownerId).
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return notFound();

  // Fine gate: an EDITOR may update ONLY their own project; ADMIN may update any.
  if (!can(session.user, "update", "Project", project)) return forbidden();

  const body = await req.json();
  const parsed = updateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const updated = await prisma.project.update({ where: { id }, data: parsed.data });
  return ok(updated); // the audit extension records who changed it automatically.
});
```

### Row-level scoping on **list** queries (the other half)

`can()` gates a _single fetched row_. For **lists**, you can't fetch-then-check every
row — push the same rule into the Prisma `where` so the DB never returns rows the
user may not see (this is the explicit `WHERE` §3 calls for). Keep the two consistent:

```ts
export const GET = withAuth(async (req, { session }) => {
  const { role, id } = session.user;
  // ADMIN sees all; EDITOR/VIEWER see only their own. Mirrors the can() update rule.
  const where = role === "ADMIN" ? {} : { ownerId: id };
  const data = await prisma.project.findMany({ where /* + pagination, sort */ });
  return ok(data);
});
```

> **Keep the list `where` and the `can()` policy in lock-step.** They encode the same
> rule in two places (the DB filter for lists, the in-memory check for single rows).
> A divergence is a real auth bug — note the pairing in a comment, and cover both in
> a test (below). A future refactor could derive the `where` from the policy, but for
> a prototype the explicit pair is clearest.

## How it composes with the existing wrappers

| Layer                                           | Question                                 | Where                           | Cost          |
| ----------------------------------------------- | ---------------------------------------- | ------------------------------- | ------------- |
| `withAuth` / `withEditorAuth` / `withAdminAuth` | What **role** is this user?              | wraps the handler               | no DB hit     |
| `can(user, action, type, row)`                  | May this user act on **this row**?       | inside the handler, after fetch | needs the row |
| Prisma `where` scoping                          | Which rows may this user **see at all**? | the list/get query              | in the query  |

Order: **wrapper first** (rejects wrong role before any work), **`can()` after the
fetch** (needs the row), **`where` scoping** on lists (so unauthorized rows never
leave the DB). `can()` does **not** bypass or replace any wrapper — a route with no
wrapper is still a CLAUDE.md violation (the `no-bare-internal-route` rule, the
ask-before list). Always pick the tightest wrapper that fits, _then_ add `can()`.

## Files to change in a fork

| File                                  | Change                                                                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/permissions.ts`                  | **New** — the `Actor` / `Ownable` types, `policies` map, `can()`. (New file under `lib/` — **Ask-before** per CLAUDE.md, and run `/code-review` since it touches authorization.) |
| `app/api/<entity>/[id]/route.ts`      | Add the `can(...)` check after the fetch on write handlers                                                                                                                       |
| `app/api/<entity>/route.ts`           | Add the ownership `where` scope to the list query                                                                                                                                |
| `tests/contracts/permissions.test.ts` | **New** — see below                                                                                                                                                              |
| `SECURITY.md` §3                      | Note that `can()` is now wired + which resources have row-level rules                                                                                                            |

No schema change unless a resource lacks an `ownerId` (add the column + a migration
if so — that's an audited-model change, scaffold it the normal way).

## How to test

A `node:test` contract over the pure `can()` logic (no DB needed — it's a function
of `actor` + `resource`):

```ts
// tests/contracts/permissions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { can } from "../../lib/permissions";

const admin = { id: "u-admin", role: "ADMIN" as const };
const editor = { id: "u-ed", role: "EDITOR" as const };
const viewer = { id: "u-vw", role: "VIEWER" as const };
const ownedByEditor = { ownerId: "u-ed" };
const ownedByOther = { ownerId: "u-other" };

test("ADMIN updates any project", () => {
  assert.equal(can(admin, "update", "Project", ownedByOther), true);
});
test("EDITOR updates only own project", () => {
  assert.equal(can(editor, "update", "Project", ownedByEditor), true);
  assert.equal(can(editor, "update", "Project", ownedByOther), false);
});
test("VIEWER cannot update", () => {
  assert.equal(can(viewer, "update", "Project", ownedByEditor), false);
});
test("default-deny on unknown resource", () => {
  assert.equal(can(admin, "update", "Unknown", ownedByEditor), false);
});
```

Then:

1. `npm test` → the new contract passes.
2. **Integration:** sign in as EDITOR-A, create a project; sign in as EDITOR-B and
   `PUT /api/projects/<A's id>` → **403** (the `can()` row check fires after
   `withEditorAuth` let the role through). EDITOR-A editing their own → 200.
3. **List scoping:** EDITOR-B's `GET /api/projects` does **not** include EDITOR-A's
   project (the `where` scope held). ADMIN's list includes both.
4. `/code-review` (touches authorization) then `/ship`.

## Rollback

Delete `lib/permissions.ts` and `tests/contracts/permissions.test.ts`, remove the
`can(...)` calls and ownership `where` scopes from the routes. The role wrappers
were never modified, so routes fall back to role-only authorization (the shipped
behavior). No migration to undo unless you added an `ownerId` column.
