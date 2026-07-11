# Recipe: TOTP two-factor authentication (step-up after password)

> `/scale-up` → shared-tier security checklist item **#1** (SECURITY.md §16).
> Closes finding **T-02** ("No MFA", open **High**). A single stolen credential is
> full account takeover without this.

## When to add it

Add this when the fork is `shared`-tier and will hold Confidential/Restricted data,
or whenever the answer to "what stops one phished password from becoming a full
takeover?" is "nothing" (SECURITY.md T1 / T-02, OWASP A07). If the org already has
SSO with MFA, prefer fronting the app with that IdP (the SSO seam in `lib/auth.ts` /
ADR-013) instead — this recipe is for forks that own their own credentials.

This wires **app-managed TOTP** (Google Authenticator / 1Password / Authy):
enroll → scan QR → app stores a secret → every subsequent login requires the
6-digit code as a **step-up** second factor before the full session is granted.

## Deps to install

```bash
npm install otplib qrcode
npm install -D @types/qrcode
```

Both are small, pure-JS (no native modules) and fine on Vercel's Node runtime.
`otplib` implements RFC-6238 TOTP; `qrcode` renders the enrollment `otpauth://` URI
to a data-URL the browser can show.

## Schema change — `prisma/schema.prisma`

Add two columns to `User` (the recipe stores the TOTP secret app-side):

```prisma
model User {
  // ...existing fields...
  mfaSecret   String?   // TOTP shared secret (base32). RESTRICTED — see below.
  mfaEnabled  Boolean   @default(false)
  // ...
}
```

Then:

```bash
npm run prisma:migrate -- --name add_user_mfa   # creates + applies the migration
npm run prisma:generate
```

> `mfaSecret` is **Restricted** — anyone holding it can mint valid codes forever.
> It MUST be added to `SCRUB_FIELDS` (next section) and ideally stored encrypted
> (compose with recipe `5-column-encryption.md` so it's encrypted at rest, not just
> scrubbed out of audit/Sentry payloads).

## Change — scrub the secret (`lib/prisma/audit-extension.ts`)

Per the CLAUDE.md hard rule ("Adding a Restricted column? Extend `SCRUB_FIELDS` ...
AND its membership assertion in `tests/contracts/audit-scrub.test.ts` in the same
commit"):

```ts
// lib/prisma/audit-extension.ts — add to the SCRUB_FIELDS set:
export const SCRUB_FIELDS = new Set([
  "passwordHash",
  "password",
  "mfaSecret", // <-- add
  "refresh_token",
  "access_token",
  // ...rest unchanged
]);
```

And in `tests/contracts/audit-scrub.test.ts`, add `"mfaSecret"` to the membership
assertion so the contract suite proves it's scrubbed. (Otherwise a `User` update
would snapshot the live TOTP secret into `audit_logs.before/after` — the exact T-03
class of bug.)

## New file — `lib/mfa.ts`

```ts
// lib/mfa.ts — TOTP helpers (recipe shared-security/2).
import { authenticator } from "otplib";
import QRCode from "qrcode";

// 30s step, 6 digits (otplib defaults). Allow ±1 window for clock skew.
authenticator.options = { window: 1 };

const ISSUER = process.env.MFA_ISSUER ?? "Rihal Prototype";

/** Generate a fresh base32 secret to store on the user (RESTRICTED). */
export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

/** Build the otpauth:// URI + a PNG data-URL QR for the authenticator app. */
export async function buildEnrollment(email: string, secret: string) {
  const otpauth = authenticator.keyuri(email, ISSUER, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  return { otpauth, qrDataUrl };
}

/** Verify a 6-digit code against the stored secret (constant-time inside otplib). */
export function verifyToken(token: string, secret: string): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  return authenticator.verify({ token, secret });
}
```

## New file — enrollment route `app/api/mfa/enroll/route.ts`

Generates a secret, returns the QR. The secret is stored but `mfaEnabled` stays
`false` until the user proves they can produce a code (the verify step). This avoids
locking a user out if they botch enrollment.

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { generateMfaSecret, buildEnrollment } from "@/lib/mfa";

// POST /api/mfa/enroll — issue (or re-issue) a secret + QR for the current user.
export const POST = withAuth(async (_req, { session }) => {
  const secret = generateMfaSecret();
  // Store the candidate secret; mfaEnabled flips only after /verify succeeds.
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { mfaSecret: secret, mfaEnabled: false },
  });
  const { otpauth, qrDataUrl } = await buildEnrollment(user.email, secret);
  // NOTE: returns the secret/otpauth to the OWNING user's own session only
  // (Restricted may be returned to the owner — SECURITY.md §1). Never log it.
  return NextResponse.json({ otpauth, qrDataUrl });
});

// Activate after the user enters a valid code from their authenticator.
const verifySchema = z.object({ token: z.string().regex(/^\d{6}$/) });

export const PUT = withAuth(async (req, { session }) => {
  const body = verifySchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid code" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.mfaSecret) return NextResponse.json({ error: "No enrollment" }, { status: 409 });

  const { verifyToken } = await import("@/lib/mfa");
  if (!verifyToken(body.data.token, user.mfaSecret)) {
    return NextResponse.json({ error: "Wrong code" }, { status: 401 });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { mfaEnabled: true },
  });
  return NextResponse.json({ enabled: true });
});
```

## New file — step-up verify route `app/api/mfa/challenge/route.ts`

After a password login, if the user has MFA enabled, the JWT carries `mfaEnabled:true`
but `mfaVerified:false`. This route accepts the 6-digit code and, on success, flips a
short-lived cookie that the JWT callback reads to set `mfaVerified:true` on the next
token refresh — see the Auth.js wiring below.

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { withAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/mfa";

const schema = z.object({ token: z.string().regex(/^\d{6}$/) });

// POST /api/mfa/challenge — the second factor at login.
export const POST = withAuth(async (req, { session }) => {
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid code" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.mfaEnabled || !user.mfaSecret) {
    return NextResponse.json({ error: "MFA not enabled" }, { status: 409 });
  }
  if (!verifyToken(body.data.token, user.mfaSecret)) {
    return NextResponse.json({ error: "Wrong code" }, { status: 401 });
  }

  // Mark this session's second factor satisfied. The JWT callback reads this
  // cookie on the next token pass and sets mfaVerified:true (then we clear it).
  const jar = await cookies();
  jar.set("mfa-ok", session.user.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60, // short-lived: only needs to survive one token refresh
  });
  return NextResponse.json({ verified: true });
});
```

## Auth.js v5 wiring — the step-up flag on the JWT

The JWT-session strategy (this template) carries the step-up state on the token.
Add `mfaEnabled` + `mfaVerified` in `lib/auth.ts`. The `authorize()` callback does
**not** change — it still validates the password. The second factor is enforced
_after_ the session exists, by middleware (below).

```ts
// lib/auth.ts callbacks — replace the jwt/session callbacks:
import { cookies } from "next/headers";

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
        // At sign-in: does this user require a second factor this session?
        // (user came from authorize(); read the flag the route returns.)
        token.mfaEnabled = (user as { mfaEnabled?: boolean }).mfaEnabled ?? false;
        token.mfaVerified = false;
      }
      // Promote to verified once the challenge route set the short-lived cookie.
      if (token.mfaEnabled && !token.mfaVerified) {
        try {
          const jar = await cookies();
          if (jar.get("mfa-ok")?.value === token.id) {
            token.mfaVerified = true;
            jar.delete("mfa-ok");
          }
        } catch {
          // cookies() unavailable in some contexts (e.g. edge) — leave unverified.
        }
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.mfaEnabled = Boolean(token.mfaEnabled);
        session.user.mfaVerified = Boolean(token.mfaVerified);
      }
      return session;
    },
  },
```

Have `authorize()` return the `mfaEnabled` flag so the first `jwt` pass sees it.
Add to the returned object in `lib/auth.ts` `authorize()`:

```ts
return {
  id: user.id,
  email: user.email,
  name: user.name,
  image: user.image,
  role: user.role,
  mfaEnabled: user.mfaEnabled, // <-- add
};
```

Augment the types (`types/index.ts`) so `session.user.mfaEnabled/mfaVerified` and the
JWT token fields are typed (mirrors the existing `role` augmentation — keeps the
`no-any-cast-on-session` rule happy):

```ts
declare module "next-auth" {
  interface User {
    role: Role;
    mfaEnabled?: boolean;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      mfaEnabled: boolean;
      mfaVerified: boolean;
    } & DefaultSession["user"];
  }
}
// NOTE: augment `@auth/core/jwt` (NOT `next-auth/jwt`) — this template's JWT
// augmentation lives there (see types/index.ts + the duplicate-@auth/core note
// in lib/auth.ts). Using `next-auth/jwt` leaves token.mfa* untyped → /ship fails.
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    mfaEnabled?: boolean;
    mfaVerified?: boolean;
  }
}
```

> **Step-up refresh caveat:** the `/mfa` page must call `useSession().update()`
> (not just `router.refresh()`) to force the `jwt` callback pass that flips
> `mfaVerified` — otherwise the middleware redirect can loop.

## Enforcement — `middleware.ts`

The existing `middleware.ts` runs on the Node runtime and already gates every
non-public path via `auth((req) => ...)`. Add a redirect: an authenticated user
whose session is `mfaEnabled && !mfaVerified` is sent to a `/mfa` challenge page
(itself reachable while half-authenticated). Insert inside the `auth(...)` callback,
after the existing unauthenticated redirect, in the non-API branch:

```ts
// Step-up: password verified but second factor still pending → force /mfa.
const sess = req.auth as { user?: { mfaEnabled?: boolean; mfaVerified?: boolean } } | null;
const needsMfa = !!sess?.user?.mfaEnabled && !sess.user.mfaVerified;
// localePrefixRegex (import from "./i18n/config") strips the config-driven
// /<locale> prefix — don't hardcode (en|ar); it rots when locales change.
const onMfaPage = pathname.replace(localePrefixRegex, "").startsWith("/mfa");
if (isAuth && needsMfa && !onMfaPage) {
  const locale = pathname.match(localePrefixRegex)?.[1] ?? routing.defaultLocale;
  return NextResponse.redirect(new URL(`/${locale}/mfa`, req.url));
}
```

Add `/mfa` and `/api/mfa/challenge` to the half-authenticated allowance — they must
be reachable while `mfaVerified` is false. (They still require a session; only the
step-up redirect is skipped for them.) `/api/mfa/enroll` and `/api/mfa/challenge`
use `withAuth`, so they're protected by a normal session regardless.

> The `/mfa` page is a small client form: POST the 6-digit code to
> `/api/mfa/challenge`, then `router.refresh()` / re-navigate so the JWT callback
> promotes `mfaVerified` and middleware lets the user through. Build it with the
> AntD `Input.OTP` + `Form` components already in the stack.

## Files to change in a fork

| File                                  | Change                                                          |
| ------------------------------------- | --------------------------------------------------------------- |
| `prisma/schema.prisma`                | Add `mfaSecret` + `mfaEnabled` to `User`; migrate               |
| `lib/prisma/audit-extension.ts`       | Add `mfaSecret` to `SCRUB_FIELDS`                               |
| `tests/contracts/audit-scrub.test.ts` | Add `mfaSecret` to the membership assertion                     |
| `lib/mfa.ts`                          | **New** — TOTP helpers                                          |
| `app/api/mfa/enroll/route.ts`         | **New** — enroll + activate                                     |
| `app/api/mfa/challenge/route.ts`      | **New** — login second factor                                   |
| `lib/auth.ts`                         | jwt/session callbacks + `authorize` return; **Ask-before file** |
| `middleware.ts`                       | Step-up redirect; **Ask-before file**                           |
| `types/index.ts`                      | Augment `mfaEnabled` / `mfaVerified`                            |
| `app/[locale]/mfa/page.tsx`           | **New** — the challenge form (client)                           |
| `.env.example`                        | `MFA_ISSUER`                                                    |

> Touches `lib/auth.ts` + `middleware.ts` (both CLAUDE.md "Ask before") and the
> auth boundary — run `/code-review` on the diff before pushing, then `/ship`.

## Env vars

```bash
MFA_ISSUER="Your App Name"   # Internal — the label shown in the authenticator app
```

No secret env var is introduced; the per-user TOTP secret lives in the DB column
(`mfaSecret`, Restricted). If you compose recipe 5, it's encrypted at rest with
`FIELD_ENCRYPTION_KEY`.

## How to test

1. `npm run prisma:migrate` then `npm test` — the scrub contract now asserts
   `mfaSecret` is in `SCRUB_FIELDS` (proves audit/Sentry won't leak it).
2. Log in, POST `/api/mfa/enroll`, scan the returned `qrDataUrl` into an
   authenticator app, PUT the 6-digit code to `/api/mfa/enroll` → `mfaEnabled` flips.
3. Log out, log back in: after the password, middleware redirects to `/mfa`; the
   wrong code is rejected, the right code grants access (subsequent navigation works
   because `mfaVerified` is now true on the token).
4. Update the user via the dashboard and inspect `audit_logs` — `mfaSecret` shows as
   `[redacted]`, never the real base32.
5. `/ship`.

## Rollback

1. Revert `lib/auth.ts`, `middleware.ts`, `types/index.ts`, `audit-extension.ts`,
   and the scrub test.
2. Delete `lib/mfa.ts`, `app/api/mfa/**`, `app/[locale]/mfa/`.
3. Create a down-migration dropping `mfaSecret` + `mfaEnabled` (or
   `prisma migrate` a new migration that removes them). **Heed the known trap:**
   `vercel.json` runs `prisma migrate deploy` on every build — don't drop the
   columns in a migration that a still-running deploy reads. Ship the code that
   stops reading them first, then drop in a follow-up deploy.
4. `npm uninstall otplib qrcode @types/qrcode`.

## SECURITY.md rows to add

**§1 Data classification** — add `users.mfaSecret` to the **Restricted** row.

**§11 Findings register** — flip **T-02** to "✅ Closed (recipe shared-security/2):
app-managed TOTP, step-up enforced in middleware". Update **§10 A04/A07** "no MFA"
notes accordingly. Flip **§16 row 1** to done.
