# Recipe: Enterprise SSO (OIDC + SAML) with JIT provisioning

> `/scale-up` → "SaaS feature: enterprise SSO". Implements the **SSO role-mapping
> seam** (`mapSsoRole` in `lib/auth.ts`) and the provider block ADR-013 reserved.
> Also satisfies SECURITY.md §16 row 1 (MFA) when the IdP enforces MFA upstream.

This recipe is **opt-in** and `shared`-tier oriented (it's how the IT team fronts
the app with their corporate IdP at handoff). The template stays on Credentials by
default; SSO is added on top, with Credentials kept as a break-glass fallback.

## When to add it

Add this when **any** is true:

- The fork is going to a `shared`-tier handoff and the IT team mandates corporate login.
- Stakeholders are "log in with our Microsoft/Okta account", not email+password.
- You need MFA but don't want to build WebAuthn/TOTP yourself (let the IdP enforce it) — this closes **T-02** / SECURITY.md §16 row 1.
- A customer requires **SAML** specifically (still common in older enterprise IdPs) → use part (b).

Pick **(a) OIDC** first — it's two providers in an array and a callback. Only fall to
**(b) SAML** when an IdP can't do OIDC.

---

## Part (a): OIDC (Microsoft Entra / Okta / generic)

### Deps

OIDC providers ship inside `next-auth` — **no new dependency**. (Auth.js v5 includes
`next-auth/providers/microsoft-entra-id`, `next-auth/providers/okta`, and a generic
OIDC shape.)

### Env contract (for the IT team)

All of these are set as Vercel project env vars. Add the names to `.env.example`
(values stay empty in the repo). **Restricted** secrets are marked.

```bash
# .env.example  — Entra example (Okta/generic are analogous)
AUTH_ENTRA_ID="<application (client) id>"
AUTH_ENTRA_SECRET="<client secret>"        # Restricted — see SECURITY.md §1
AUTH_ENTRA_TENANT_ID="<directory (tenant) id>"

# Okta variant
# AUTH_OKTA_ID="<client id>"
# AUTH_OKTA_SECRET="<client secret>"        # Restricted
# AUTH_OKTA_ISSUER="https://<org>.okta.com/oauth2/default"

# Generic OIDC variant
# AUTH_OIDC_ID="<client id>"
# AUTH_OIDC_SECRET="<client secret>"        # Restricted
# AUTH_OIDC_ISSUER="https://idp.example.com"

# Comma-separated IdP group/role names that should map to each app Role.
# Least-privilege: anything not listed lands on VIEWER.
SSO_ADMIN_GROUPS="app-admins"
SSO_EDITOR_GROUPS="app-editors"
```

> **Redirect URI** to register with the IdP:
> `https://<slug>.vercel.app/api/auth/callback/microsoft-entra-id` (swap the trailing
> segment for `okta` or your generic provider id). For OIDC group claims, configure the
> IdP to emit `groups` (Entra: "Groups" optional claim → group **names** or object ids;
> Okta: a `groups` claim in the ID token via a claim filter).

### File to change: `lib/auth.ts`

**1. Implement the `mapSsoRole` seam** (replace the stub body):

```ts
// lib/auth.ts  — replace the existing mapSsoRole stub

/**
 * SSO SEAM (ADR-013): map an IdP's claims to our Role enum.
 * Least-privilege by default (VIEWER); promote only on explicit group membership.
 * Group names come from SSO_ADMIN_GROUPS / SSO_EDITOR_GROUPS (comma-separated).
 */
export function mapSsoRole(claims: Record<string, unknown> | undefined): Role {
  const groups = extractGroups(claims);
  const admin = csv(process.env.SSO_ADMIN_GROUPS);
  const editor = csv(process.env.SSO_EDITOR_GROUPS);
  if (groups.some((g) => admin.has(g))) return "ADMIN";
  if (groups.some((g) => editor.has(g))) return "EDITOR";
  return "VIEWER"; // misconfigured IdP can never grant elevated access
}

function csv(v: string | undefined): Set<string> {
  return new Set(
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// IdPs disagree on the claim name; check the common ones.
function extractGroups(claims: Record<string, unknown> | undefined): string[] {
  if (!claims) return [];
  const raw =
    (claims.groups as unknown) ??
    (claims.roles as unknown) ??
    (claims["http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"] as unknown);
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return raw.split(",").map((s) => s.trim());
  return [];
}
```

**2. Add the provider(s)** to the `providers` array (replace the commented seam at the
bottom of the array). Import at the top of the file:

```ts
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
// import Okta from "next-auth/providers/okta";
// import { OAuthConfig } from "next-auth/providers"; // for fully-generic OIDC
```

```ts
// inside providers: [ ... Credentials({...}), <here> ]

// Only register the provider when its env is present, so a fork without SSO
// configured still boots on Credentials alone.
...(process.env.AUTH_ENTRA_ID
  ? [
      MicrosoftEntraID({
        clientId: process.env.AUTH_ENTRA_ID,
        clientSecret: process.env.AUTH_ENTRA_SECRET!,
        issuer: `https://login.microsoftonline.com/${process.env.AUTH_ENTRA_TENANT_ID}/v2.0`,
        authorization: { params: { scope: "openid profile email" } },
      }),
    ]
  : []),

// Okta variant:
// ...(process.env.AUTH_OKTA_ID
//   ? [Okta({ clientId: process.env.AUTH_OKTA_ID, clientSecret: process.env.AUTH_OKTA_SECRET!, issuer: process.env.AUTH_OKTA_ISSUER })]
//   : []),
```

**3. Map the role in the `jwt` callback.** The existing callback only copies role from
`user` (Credentials path). On the SSO path, `user.role` is the adapter's DB default
(`VIEWER`) and `profile` carries the IdP claims. Extend the callback to honour the IdP:

```ts
// lib/auth.ts  — replace the existing jwt callback

callbacks: {
  async jwt({ token, user, account, profile }) {
    if (user) {
      token.id = user.id!;
      token.role = user.role;
    }
    // SSO login: derive role from IdP claims and persist it on the User row so
    // the app's own role checks (and the admin UI) stay the source of truth.
    // Match BOTH OIDC providers (account.type "oidc") AND the BoxyHQ SAML
    // provider from part (b), which Auth.js types as "oauth" -- otherwise SAML
    // logins skip role mapping here (they still get role via the provider's
    // profile(), but gate on both so this block is the single source of truth).
    if (account && (account.type === "oidc" || account.type === "oauth") && profile) {
      const role = mapSsoRole(profile as Record<string, unknown>);
      token.role = role;
      if (token.id) {
        await prismaUnfiltered.user.update({
          where: { id: token.id as string },
          data: { role, lastLoginAt: new Date() },
        });
      }
    }
    return token;
  },
  session({ session, token }) {
    if (session.user) {
      session.user.id = token.id as string;
      session.user.role = token.role as Role;
    }
    return session;
  },
},
```

> **JIT provisioning is free here.** The `PrismaAdapter` (already wired on line 26 of
> `lib/auth.ts`) creates the `User` + `Account` rows on first SSO login automatically —
> you do not write user-creation code. The adapter inserts the user at the schema
> default `role = VIEWER`; the `jwt` callback above then upgrades it from the IdP group
> claims on the same request. Credentials users are unaffected.

> **Account linking note.** By default Auth.js does **not** auto-link an OIDC login to an
> existing Credentials user with the same email (anti-takeover). If your IdP owns the
> email namespace and you _want_ linking, add `allowDangerousEmailAccountLinking: true`
> to the provider — only when the IdP's emails are verified and trusted. Document the
> choice in SECURITY.md.

### File to change: keep Credentials as fallback

Nothing to do — Credentials stays in the array. Keep the seeded admin so there's a
break-glass login if the IdP is misconfigured. Once SSO is verified in production, the
IT team may disable Credentials by removing it from the array (record in an ADR).

### How to test (OIDC)

1. Register an app in the IdP, set the redirect URI above, create two test users in an
   admin group and a non-admin group.
2. `AUTH_ENTRA_ID` etc. in `.env`, `npm run dev`.
3. The `/login` page shows the SSO button automatically (Auth.js renders one button per
   registered provider on its default sign-in flow; if you use the custom `/login` form,
   add a `signIn("microsoft-entra-id")` button — see `app/[locale]/login`).
4. Log in as the admin-group user → confirm `session.user.role === "ADMIN"` (admin nav
   visible). Log in as the other → `VIEWER`.
5. Check the DB: `npm run prisma:studio` → a `users` row + an `accounts` row (provider
   `microsoft-entra-id`) were created by the adapter (JIT).
6. Deactivate the admin group membership in the IdP, log in again → role drops to
   `VIEWER` on next login (re-derived every time).

### Rollback (OIDC)

- Remove the provider entry from the `providers` array (or just unset `AUTH_ENTRA_ID` —
  the guard drops it). Revert `mapSsoRole` and the `jwt` callback to the template stub.
- Existing SSO-provisioned `users`/`accounts` rows are harmless; soft-delete or leave
  them. Credentials login keeps working throughout.

---

## Part (b): SAML (for IdPs that require it)

Use this only when an IdP can't do OIDC. We front SAML with **`@boxyhq/saml-jackson`**,
which terminates SAML and re-exposes it to Auth.js as a normal OAuth/OIDC-shaped provider
(`boxyhq-saml`) — so the role mapping above is reused unchanged.

### Deps

```bash
npm install @boxyhq/saml-jackson
```

> `saml-jackson` is **> 50 KB** and pulls transitive deps — per CLAUDE.md "Ask before
> installing a runtime dep > 50 KB", this needs an ADR. It is referenced here as the
> sanctioned SAML path, but record `/adr` "SAML via saml-jackson" before merging. Jackson
> needs its own Postgres store; point it at the same Neon DB (it manages its own tables).

### Env contract (SAML)

```bash
# .env.example
JACKSON_DB_URL="${DATABASE_URL}"          # Jackson reuses Neon; it owns its own tables
SAML_AUDIENCE="https://<slug>.vercel.app"
NEXTAUTH_SAML_CLIENT_SECRET="dummy"       # Jackson's OAuth shim secret — Restricted
SAML_JACKSON_API_KEY="<random 32+ char>"  # gates the Jackson admin/SSO-config API — Restricted
```

### Files to add

**`lib/jackson.ts`** — singleton controllers:

```ts
import jackson, {
  type IConnectionAPIController,
  type IOAuthController,
} from "@boxyhq/saml-jackson";

const opts = {
  externalUrl: process.env.SAML_AUDIENCE!,
  samlPath: "/api/auth/saml/callback",
  samlAudience: process.env.SAML_AUDIENCE!,
  db: { engine: "sql" as const, type: "postgres" as const, url: process.env.JACKSON_DB_URL! },
};

let cached: { conn: IConnectionAPIController; oauth: IOAuthController } | null = null;

export async function getJackson() {
  if (cached) return cached;
  const ctrls = await jackson(opts);
  cached = { conn: ctrls.connectionAPIController, oauth: ctrls.oauthController };
  return cached;
}
```

**`app/api/auth/saml/callback/route.ts`** — the ACS endpoint the IdP POSTs to. Mount it
as a public path (it's pre-auth, like `/api/auth/*` already is — it lives under
`/api/auth` so middleware already lets it through):

```ts
import { NextRequest, NextResponse } from "next/server";
import { getJackson } from "@/lib/jackson";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const body = Object.fromEntries(form.entries()) as Record<string, string>;
  const { oauth } = await getJackson();
  const { redirect_url } = await oauth.samlResponse(body);
  return NextResponse.redirect(redirect_url!, 302);
}
```

**Register the BoxyHQ provider** in `lib/auth.ts` `providers` array — it speaks OAuth to
Jackson's local endpoints, so the existing `mapSsoRole`/`jwt` wiring from part (a) applies
verbatim:

```ts
{
  id: "boxyhq-saml",
  name: "Corporate SSO",
  type: "oauth",
  authorization: { url: `${process.env.SAML_AUDIENCE}/api/oauth/authorize`, params: { scope: "" } },
  token: `${process.env.SAML_AUDIENCE}/api/oauth/token`,
  userinfo: `${process.env.SAML_AUDIENCE}/api/oauth/userinfo`,
  clientId: "dummy",
  clientSecret: process.env.NEXTAUTH_SAML_CLIENT_SECRET!,
  profile(profile: Record<string, unknown>) {
    return {
      id: String(profile.id),
      email: String(profile.email),
      name: (profile.firstName && profile.lastName)
        ? `${profile.firstName} ${profile.lastName}`
        : (profile.email as string),
      role: mapSsoRole(profile), // groups arrive in the SAML assertion → profile
    };
  },
},
```

You also add the standard Jackson OAuth + connection routes (`/api/oauth/authorize`,
`/token`, `/userinfo`, and an admin route to register IdP metadata). These are thin
pass-throughs to `getJackson()` controllers — see the BoxyHQ Next.js example for the
exact handler bodies; each is ~5 lines calling `oauth.authorize` / `oauth.token` /
`oauth.userInfo`. **Wrap the connection-management route with `withAdminAuth`** so only an
app admin can register an IdP, and add `/api/oauth` to `middleware.ts` `publicPaths`
(the authorize/token/userinfo legs are pre-session by nature).

### How to test (SAML)

Use a free hosted test IdP (e.g. mocksaml.com) or your real IdP's metadata. Register the
connection via the admin route, then hit `signIn("boxyhq-saml")` and confirm the same
JIT-provision + role-mapping behaviour as OIDC.

### Rollback (SAML)

- Remove the `boxyhq-saml` provider, the `/api/auth/saml`, `/api/oauth` routes, and
  `lib/jackson.ts`. `npm uninstall @boxyhq/saml-jackson`.
- Jackson's own tables are isolated; drop them in a follow-up migration if desired (they
  don't touch the app schema).

---

## Security notes (both parts)

- Add an **SSO row** to SECURITY.md §1: `AUTH_ENTRA_SECRET` / `AUTH_OKTA_SECRET` /
  `AUTH_OIDC_SECRET` / `NEXTAUTH_SAML_CLIENT_SECRET` / `SAML_JACKSON_API_KEY` are
  **Restricted** (same class as `AUTH_GOOGLE_SECRET`). They never log, never leave Vercel
  env. `gitleaks` (via `/ship`) gates them.
- `mapSsoRole` is **least-privilege**: anything not in the admin/editor allowlist is
  `VIEWER`. A misconfigured or hostile IdP claim therefore cannot self-grant ADMIN.
- Changing how roles are derived is a CLAUDE.md "Ask before" item — confirm with the
  operator and note the role-derivation change in SECURITY.md §3.
- Keep Credentials enabled until SSO is verified in prod (break-glass). Disabling it is an
  ADR-worthy decision.
- Run **`/code-review`** before pushing (this touches `lib/auth.ts`, an "Ask before" file)
  and **`/ship`** (typecheck → lint → tests → build → gitleaks → npm audit).

## The `signIn` guard is already in `lib/auth.ts` — do not remove it

`lib/auth.ts` keeps a `signIn` callback that denies a federated sign-in when the linked
`users` row is soft-deleted. With no OAuth provider registered it never fires, so it can
look like dead code worth deleting. It is not:

- the Credentials `authorize()` filters `deletedAt: null`, but the federated path goes
  through `PrismaAdapter(prismaUnfiltered)`, which does **not**;
- so without the guard, an off-boarded (soft-deleted) SSO user keeps signing in
  indefinitely — the exact failure a directory-sync integration is supposed to prevent.

The moment you register a provider by following this recipe, that branch becomes live and
correct. It matches both `"oauth"` and `"oidc"` account types, because Auth.js labels an
OIDC account's type `"oidc"` and keying on `"oauth"` alone silently misses every OIDC
provider. Existing JWTs persist until `session.maxAge`; rotate `AUTH_SECRET` to revoke
immediately (SECURITY.md §2).

If you also enable email account-linking (`allowDangerousEmailAccountLinking`), pair it
with a check that the matched row is passwordless — otherwise a spoofable email claim can
link to a real password user. The removed implementation scoped that flag to the SAML
bridge only, for that reason.
