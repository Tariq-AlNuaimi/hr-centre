# Recipe: SCIM 2.0 user provisioning

> `/scale-up` → "SaaS feature: SCIM provisioning". Exposes a SCIM 2.0
> `/api/scim/v2/Users` + `/Groups` surface so an enterprise IdP (Entra / Okta /
> OneLogin) can drive the **user lifecycle** — auto-create on assignment,
> deactivate on offboarding — without anyone touching the app. Gated by a bearer
> SCIM token reusing the `withApiAuth` pattern (ADR-013).

This recipe is **opt-in** and almost always a **large-org `shared`-tier handoff** concern.
Most prototypes never need it. Add it only when an IT team mandates IdP-driven provisioning.

It pairs naturally with the **SSO** recipe (`docs/recipes/saas/1-sso-oidc-saml.md`): SSO
handles _authentication_ (who's logging in), SCIM handles _provisioning_ (which accounts
exist and are active). They map roles through the same `Role` enum but are independent — you
can run either alone.

## When to add it

Add this when **all** of these tend to hold:

- The fork is going to a `shared`-tier handoff to an org with hundreds+ of users.
- The IT team wants offboarded employees **automatically deactivated** here (compliance).
- Manual user management in the admin UI doesn't scale / isn't allowed.

If you only need login, use the **SSO** recipe with **JIT provisioning** — that creates users
on first login for free and is enough for small teams. SCIM adds _deactivation_ and
_pre-provisioning_ (account exists before first login), which JIT can't do.

## Deps

None — SCIM is plain JSON over HTTP. We map SCIM attributes onto the existing `User` model by
hand (it's a small, fixed schema). No SCIM library needed for the Users/Groups core.

---

## The auth gate (reuse the `withApiAuth` pattern)

SCIM endpoints are called by the IdP with a static bearer token (`Authorization: Bearer
<SCIM_TOKEN>`). This is exactly the base `withApiAuth(tokenEnv, handler)` shared-secret seam —
reuse it directly. It returns 503 if the env var is unset (SCIM disabled) and 401 on a bad
token, with constant-time comparison.

> SCIM bodies do not carry an Auth.js session — `withApiAuth` is the correct wrapper (not
> `withAuth`). Audit writes inside these handlers attribute to `userId: null` (no session),
> which is the right record: "provisioned by the IdP". Query the audit log by `entityType =
"User"` + time window.

### Env vars

```bash
# .env / .env.example  — and the Vercel project env
SCIM_TOKEN="<random 32+ char>"   # Restricted — the IdP's provisioning bearer token
```

Generate with `openssl rand -base64 32`. The IdP stores its copy; rotating means updating both
sides.

### Public path

SCIM lives under `/api/scim/*` and is **not** session-gated. Add `/api/scim` to
`middleware.ts` `publicPaths` so the bearer-gated handlers are reachable (adding a new public
path is a CLAUDE.md "Ask before" item — confirm with the operator; the `withApiAuth` gate is
the real protection, middleware just lets it through):

```ts
// middleware.ts  — add to the publicPaths list (alongside /api/auth, /api/health, /api/internal)
  "/api/scim",
```

---

## Mapping SCIM ↔ the `User` model

| SCIM attribute                       | `User` field       | Note                                                                                                                                         |
| ------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `userName`                           | `email`            | The IdP's unique key. Lowercased on write (matches Credentials lookup).                                                                      |
| `name.givenName` + `name.familyName` | `name`             | Joined with a space.                                                                                                                         |
| `emails[primary].value`              | `email`            | Falls back to `userName` if absent.                                                                                                          |
| `active: false`                      | `deletedAt` set    | **Soft-delete, never hard-delete** (audit + recovery).                                                                                       |
| `active: true`                       | `deletedAt = null` | Re-activation restores a soft-deleted user.                                                                                                  |
| SCIM `id`                            | `User.id` (cuid)   | We return our cuid as the SCIM resource id.                                                                                                  |
| role (via `Groups` or SSO)           | `User.role`        | SCIM core doesn't set roles; default new users to `VIEWER` (least privilege). Wire group→role through `mapSsoRole` if the IdP pushes groups. |

> Deprovisioning is `active: false` → soft-delete (sets `deletedAt`), **not** `DELETE` of the
> row. Use `prismaUnfiltered` for SCIM reads/writes so the handler can see and re-activate
> soft-deleted users (same reason the auth `authorize()` callback uses it). The soft-delete
> extension on `prisma` would hide deactivated users from the IdP's `GET`/`PATCH`.

---

## Files to add

### `lib/scim.ts` — mappers

```ts
// lib/scim.ts
import type { User } from "@/generated/prisma/client";

const SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";

/** Our User row → a SCIM User resource. */
export function toScimUser(u: User) {
  const [givenName, ...rest] = (u.name ?? "").split(" ");
  return {
    schemas: [SCHEMA_USER],
    id: u.id,
    userName: u.email,
    name: { givenName: givenName ?? "", familyName: rest.join(" ") },
    emails: [{ value: u.email, primary: true }],
    active: u.deletedAt === null,
    meta: { resourceType: "User", created: u.createdAt, lastModified: u.updatedAt },
  };
}

/** A SCIM create/replace body → the fields we persist. */
export function fromScimUser(body: Record<string, unknown>) {
  const userName = String(body.userName ?? "")
    .toLowerCase()
    .trim();
  const name = body.name as { givenName?: string; familyName?: string } | undefined;
  const emails = body.emails as Array<{ value: string; primary?: boolean }> | undefined;
  const email = (emails?.find((e) => e.primary)?.value ?? userName).toLowerCase().trim();
  return {
    email,
    name: [name?.givenName, name?.familyName].filter(Boolean).join(" ") || null,
    active: body.active === undefined ? true : Boolean(body.active),
  };
}

export function scimError(status: number, detail: string) {
  return Response.json(
    { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: String(status), detail },
    { status },
  );
}
```

### `app/api/scim/v2/Users/route.ts` — list + create

```ts
// app/api/scim/v2/Users/route.ts
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-helpers";
import { prismaUnfiltered } from "@/lib/prisma";
import { toScimUser, fromScimUser, scimError } from "@/lib/scim";

// GET /api/scim/v2/Users?filter=userName eq "x@y.com"
export const GET = withApiAuth("SCIM_TOKEN", async (req) => {
  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") ?? "";
  // SCIM filters we support: userName eq "value". (Extend if the IdP needs more.)
  const m = /userName eq "([^"]+)"/i.exec(filter);
  const where = m ? { email: m[1].toLowerCase().trim() } : {};
  const users = await prismaUnfiltered.user.findMany({ where });
  return NextResponse.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: users.length,
    startIndex: 1,
    itemsPerPage: users.length,
    Resources: users.map(toScimUser),
  });
});

// POST /api/scim/v2/Users — provision a new user (or re-activate a soft-deleted one)
export const POST = withApiAuth("SCIM_TOKEN", async (req) => {
  const body = (await req.json()) as Record<string, unknown>;
  const { email, name } = fromScimUser(body);
  if (!email) return scimError(400, "userName/email is required");

  const existing = await prismaUnfiltered.user.findUnique({ where: { email } });
  if (existing) {
    // Idempotent provisioning: re-activate if previously deprovisioned.
    const user = await prismaUnfiltered.user.update({
      where: { email },
      data: { name, deletedAt: null, deletedBy: null },
    });
    return NextResponse.json(toScimUser(user), { status: 200 });
  }

  const user = await prismaUnfiltered.user.create({
    data: { email, name, role: "VIEWER" }, // least privilege; SSO/Groups can elevate later
  });
  return NextResponse.json(toScimUser(user), { status: 201 });
});
```

### `app/api/scim/v2/Users/[id]/route.ts` — get, replace, patch (deprovision)

```ts
// app/api/scim/v2/Users/[id]/route.ts
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-helpers";
import { prismaUnfiltered } from "@/lib/prisma";
import { toScimUser, fromScimUser, scimError } from "@/lib/scim";

export const GET = withApiAuth("SCIM_TOKEN", async (_req, { params }) => {
  const { id } = await params;
  const user = await prismaUnfiltered.user.findUnique({ where: { id } });
  if (!user) return scimError(404, "User not found");
  return NextResponse.json(toScimUser(user));
});

// PUT — full replace (Okta uses this for updates)
export const PUT = withApiAuth("SCIM_TOKEN", async (req, { params }) => {
  const { id } = await params;
  const { email, name, active } = fromScimUser((await req.json()) as Record<string, unknown>);
  const user = await prismaUnfiltered.user.update({
    where: { id },
    data: { email, name, deletedAt: active ? null : new Date(), deletedBy: active ? null : "scim" },
  });
  return NextResponse.json(toScimUser(user));
});

// PATCH — the deprovision path (Entra/Okta send { Operations: [{ op:"replace", value:{ active:false }}] })
export const PATCH = withApiAuth("SCIM_TOKEN", async (req, { params }) => {
  const { id } = await params;
  const body = (await req.json()) as {
    Operations?: Array<{ op: string; value?: Record<string, unknown> }>;
  };
  let active: boolean | undefined;
  for (const op of body.Operations ?? []) {
    if (op.value && "active" in op.value) active = Boolean(op.value.active);
  }
  if (active === undefined)
    return scimError(400, "Unsupported PATCH (only active toggle is handled)");

  const user = await prismaUnfiltered.user.update({
    where: { id },
    // Soft-delete on deprovision — NEVER a hard delete (audit + recovery).
    data: { deletedAt: active ? null : new Date(), deletedBy: active ? null : "scim" },
  });
  return NextResponse.json(toScimUser(user));
});
```

> **DELETE.** Some IdPs send `DELETE` on offboarding. Map it to a **soft-delete**, not a row
> removal — add a `DELETE` export that sets `deletedAt`. Never remove the `users` row (the
> audit trail and FK references depend on it).

### `app/api/scim/v2/Groups/route.ts` — minimal Groups

Most IdPs require a `/Groups` endpoint to exist even if you map groups to roles elsewhere. A
minimal read-only implementation backed by the `Role` enum satisfies the SCIM discovery /
push handshake:

```ts
// app/api/scim/v2/Groups/route.ts
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-helpers";

// Expose the app's roles as SCIM Groups so the IdP can map its groups onto them.
const GROUPS = ["ADMIN", "EDITOR", "VIEWER"];

export const GET = withApiAuth("SCIM_TOKEN", async () => {
  return NextResponse.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: GROUPS.length,
    startIndex: 1,
    itemsPerPage: GROUPS.length,
    Resources: GROUPS.map((g) => ({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: g,
      displayName: g,
    })),
  });
});
```

> Full bidirectional group **membership** sync (IdP pushes `members` → set `User.role`) is
> more involved; wire role changes through `mapSsoRole` (recipe 1) on the membership PATCH if
> the IdP drives roles. For most handoffs, roles are set at login via SSO and `/Groups` only
> needs to enumerate.

---

## Audit + soft-delete notes

- `User` is **not** in the audit `EXCLUDE` set, so SCIM create/update/soft-delete are audited
  automatically — attributed to `null` user (IdP-driven), with the `deletedAt` transition
  recorded as a `DELETE`/`RESTORE` action by the audit extension's existing soft-delete
  detection (see `lib/prisma/audit-extension.ts` lines ~158-163). No audit changes needed.
- `passwordHash` stays `null` for SCIM-provisioned users — they authenticate via SSO, not
  Credentials. (A SCIM user with no password simply can't use the Credentials form, which is
  correct.)

---

## SECURITY.md rows to add

Add to **§1 Data classification**:

| Field        | Class          | Note                                                                                                                                                    |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCIM_TOKEN` | **Restricted** | Bearer token the IdP uses to drive provisioning. Full read/create/deactivate over the user directory — secret-equivalent. Never logged, gitleaks-gated. |

Note in **§2 Authentication / §3 Authorization**: `/api/scim/v2/*` is a public path gated by
`withApiAuth("SCIM_TOKEN", …)` (bearer, constant-time). New SCIM users default to `VIEWER`
(least privilege). Deprovisioning is **soft-delete**, never row removal. Note in **§7
(retention)** that SCIM-deactivated users remain as soft-deleted rows (recoverable / auditable)
and are subject to the recycling-bin retention policy like any soft-deleted entity.

---

## How to test

1. Set `SCIM_TOKEN` in `.env`, add `/api/scim` to `middleware.ts` `publicPaths`, `npm run dev`.
2. Create a user:
   ```bash
   curl -X POST http://localhost:3000/api/scim/v2/Users \
     -H "Authorization: Bearer $SCIM_TOKEN" -H "content-type: application/scim+json" \
     -d '{"userName":"jane@acme.com","name":{"givenName":"Jane","familyName":"Doe"},"active":true}'
   ```
   → 201 + a SCIM User with an `id`. `prisma:studio` shows a `users` row, `role=VIEWER`,
   `deletedAt=null`.
3. Deprovision:
   ```bash
   curl -X PATCH http://localhost:3000/api/scim/v2/Users/<id> \
     -H "Authorization: Bearer $SCIM_TOKEN" \
     -d '{"Operations":[{"op":"replace","value":{"active":false}}]}'
   ```
   → 200 + `active:false`. The row now has `deletedAt` set (NOT removed). The user can no
   longer log in (Credentials `authorize` filters `deletedAt: null`).
4. Re-provision (POST the same `userName` again, or PATCH `active:true`) → `deletedAt` cleared,
   same row reused (idempotent).
5. Omit/typo the bearer → 401. Unset `SCIM_TOKEN` and restart → 503 (SCIM disabled).
6. `GET /api/scim/v2/Users?filter=userName eq "jane@acme.com"` → ListResponse with one
   Resource. Check `audit_logs` for the create/deactivate rows. `npm run lint` / `npm test`.
7. (Optional) Point a real IdP's SCIM provisioning at `https://<slug>.vercel.app/api/scim/v2`
   with the token; run its "test connection" + assign/unassign a test user.

---

## Rollback

- Remove `app/api/scim/**` and `lib/scim.ts`. Remove `/api/scim` from `middleware.ts`
  `publicPaths`. Unset `SCIM_TOKEN` everywhere.
- No schema migration is needed — SCIM reuses the existing `User` model (no new columns).
  SCIM-provisioned users remain as ordinary rows; deactivated ones stay soft-deleted and are
  cleaned up by the normal recycling-bin retention.
