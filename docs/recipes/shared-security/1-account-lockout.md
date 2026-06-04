# Recipe: Account lockout (cross-instance brute-force throttle)

> `/scale-up` → shared-tier security checklist item **#4** (SECURITY.md §16).
> Closes the A07 gap and the cross-instance hole in **T-01**.

## When to add it

Add this when **any** of these is true:

- The fork is `shared`-tier and approaching handoff (SECURITY.md §16 row 4 is "done or risk-accepted").
- The app runs on more than one concurrent Vercel function instance (the in-memory
  limiter in `lib/rate-limit.ts` is **per-instance** and reset on cold start, so a
  round-robin attacker bypasses it — see the header comment in that file and SECURITY.md §2).
- You want a *per-account* lockout (N bad passwords on one email → temporary lock),
  which the IP-bucket limiter cannot express.

This recipe does **two** things with one Redis dependency:
1. **Per-account lockout** wired into `lib/auth.ts` `authorize()`.
2. **Replaces the in-memory per-IP limiter** on `/api/auth/*` with a shared-state one
   (closes the cross-instance part of T-01).

## Deps to install

```bash
npm install @upstash/ratelimit @upstash/redis
```

Both are small, pure-JS, edge-compatible clients (HTTP, not TCP) — no native modules,
fine on Vercel. (Per CLAUDE.md "Ask before installing a runtime dep > 50 KB" — these are
each well under and are the exact libraries SECURITY.md §16 / the `/scale-up` table name,
so no new ADR is required.)

## Env vars

Create an Upstash Redis database (free tier: 10k commands/day) at https://console.upstash.com,
then copy its **REST** URL + token. Add to `.env`, `.env.example`, and the Vercel project env.

```bash
# .env / .env.example  (REST creds — the HTTP client, NOT the redis:// TCP URL)
UPSTASH_REDIS_REST_URL="https://<your-db>.upstash.io"
UPSTASH_REDIS_REST_TOKEN="<token>"
# Optional tuning (defaults shown):
ACCOUNT_LOCKOUT_MAX_FAILS="5"          # bad passwords before lock
ACCOUNT_LOCKOUT_WINDOW_SEC="900"       # rolling window the fails are counted in (15 min)
ACCOUNT_LOCKOUT_DURATION_SEC="900"     # how long the lock lasts once tripped (15 min)
```

`UPSTASH_REDIS_REST_TOKEN` is **Restricted** (it grants full read/write to the limiter
store). Never log it; gitleaks already gates it on `/ship`.

## New file: `lib/account-lockout.ts`

```ts
// lib/account-lockout.ts
//
// Cross-instance brute-force defense, backed by Upstash Redis (HTTP).
// Two surfaces:
//   1) recordFailedLogin / clearFailedLogins / isLockedOut — PER-ACCOUNT lockout,
//      consumed by lib/auth.ts authorize().
//   2) authIpRateLimiter — a shared-state replacement for the in-memory per-IP
//      limiter on /api/auth/* (closes the cross-instance hole in T-01).
//
// All keys are namespaced; the email is hashed (sha256) so a raw address never
// becomes a Redis key (Confidential per SECURITY.md §1).

import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

const MAX_FAILS = Number(process.env.ACCOUNT_LOCKOUT_MAX_FAILS ?? 5);
const WINDOW_SEC = Number(process.env.ACCOUNT_LOCKOUT_WINDOW_SEC ?? 900);
const LOCK_SEC = Number(process.env.ACCOUNT_LOCKOUT_DURATION_SEC ?? 900);

// Fail closed-but-usable: if Upstash isn't configured, lockout is a no-op so the
// template still runs locally without Redis. A shared-tier fork MUST set the env
// vars before handoff (SECURITY.md §16 row 4) or this protection is inert.
function redisOrNull(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL / _TOKEN
}

const redis = redisOrNull();

function emailKey(email: string): string {
  const h = createHash("sha256").update(email).digest("hex").slice(0, 32);
  return `lockout:fail:${h}`;
}

/** True once the account has crossed MAX_FAILS within the window. */
export async function isLockedOut(email: string): Promise<boolean> {
  if (!redis) return false;
  const count = await redis.get<number>(emailKey(email));
  return (count ?? 0) >= MAX_FAILS;
}

/** Increment the fail counter; first failure seeds the TTL (the rolling window). */
export async function recordFailedLogin(email: string): Promise<void> {
  if (!redis) return;
  const key = emailKey(email);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SEC);
  // Once tripped, hold the lock for LOCK_SEC (re-arm the TTL to the lock duration).
  if (count >= MAX_FAILS) await redis.expire(key, LOCK_SEC);
}

/** Clear on a successful authentication. */
export async function clearFailedLogins(email: string): Promise<void> {
  if (!redis) return;
  await redis.del(emailKey(email));
}

// Shared-state per-IP limiter for /api/auth/* — drop-in replacement for the
// in-memory lib/rate-limit.ts on that route (T-01). 10 req / 60s sliding window.
export const authIpRateLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "60 s"),
      prefix: "rl:auth",
    })
  : null;
```

## Change 1 — wire lockout into `lib/auth.ts`

In `lib/auth.ts`, inside the Credentials `authorize()` callback. Current code (lines
~38–73) looks up the user, `bcrypt.compare`s, and on failure `return null`. Add the
lockout checks around it:

```ts
// top of lib/auth.ts, with the other imports
import {
  isLockedOut,
  recordFailedLogin,
  clearFailedLogins,
} from "./account-lockout";
```

```ts
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = (credentials.email as string).toLowerCase().trim();

        // --- account lockout: deny before doing bcrypt work ---
        if (await isLockedOut(email)) {
          // Throwing surfaces as a CredentialsSignin error to the client without
          // revealing whether the account exists. Returning null would let the
          // attacker keep probing; a throw also short-circuits the bcrypt cost.
          throw new Error("AccountLocked");
        }

        const user = await prismaUnfiltered.user.findUnique({
          where: { email, deletedAt: null },
        });

        if (!user?.passwordHash) {
          // Count misses too, so an attacker can't enumerate-then-spray for free.
          await recordFailedLogin(email);
          return null;
        }

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!valid) {
          await recordFailedLogin(email);
          return null;
        }

        // Success: clear the counter and update last login.
        await clearFailedLogins(email);
        await prismaUnfiltered.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
```

> Note: `authorize` runs on the Node runtime (the credentials path; `middleware.ts`
> already pins `runtime = "nodejs"`), so `node:crypto` and the Upstash HTTP client are
> both fine here.

## Change 2 — replace the in-memory limiter on `/api/auth/*` (closes T-01 cross-instance)

Edit `app/api/auth/[...nextauth]/route.ts`. Replace the `rateLimit(...)` call (the
in-memory one) with the shared-state limiter:

```ts
import { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { authIpRateLimiter } from "@/lib/account-lockout";
import { rateLimit } from "@/lib/rate-limit"; // fallback when Upstash is unset

export const GET = handlers.GET;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  // Prefer the cross-instance limiter; fall back to in-memory if Upstash isn't
  // configured (local dev), so the route is never un-throttled.
  if (authIpRateLimiter) {
    const { success, reset } = await authIpRateLimiter.limit(clientIp(req));
    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": String(retryAfter) },
      });
    }
  } else {
    const result = rateLimit(req, { id: "auth", limit: 10, windowMs: 60_000 });
    if (!result.ok) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": String(result.retryAfter) },
      });
    }
  }
  return handlers.POST(req);
}
```

> The `tests/contracts/rate-limit.test.ts` contract suite still asserts the in-memory
> `rateLimit()` semantics directly (not this route), so it keeps passing. Leave
> `lib/rate-limit.ts` in place — it's still the documented fallback and other routes
> (e.g. `forgot-password`) use it.

## Files to change in a fork

| File | Change |
|---|---|
| `lib/account-lockout.ts` | **New** — the helper above |
| `lib/auth.ts` | Import the helpers; add lockout to `authorize()` |
| `app/api/auth/[...nextauth]/route.ts` | Swap in `authIpRateLimiter` (fallback kept) |
| `.env.example` / `.env` / Vercel env | Add the 5 vars |
| `SECURITY.md` | Add the rows below; flip §16 row 4 to done |

> `lib/auth.ts` is in the CLAUDE.md "Ask before touching" list. Run the native
> `/code-review` on this diff before pushing (it touches auth), then `/ship`.

## How to test

1. **Unit-ish, no Redis:** with the Upstash env vars **unset**, `isLockedOut` returns
   `false` and the route falls back to the in-memory limiter. `npm test` and `npm run dev`
   behave exactly as the base template. Confirms the fail-open path.
2. **With Redis (local or staging):** set the env vars, then from the login page submit
   a wrong password for one account `ACCOUNT_LOCKOUT_MAX_FAILS` times. The next attempt —
   **even with the correct password** — fails with the locked error until the lock TTL
   expires. Verify in the Upstash console that `lockout:fail:<hash>` exists with a TTL.
3. **Cross-instance check (optional):** confirm the `rl:auth:*` keys appear in Upstash
   under load — proves the limiter is now shared, not per-function.
4. `npm run lint && npm test && npm run build` (or `/ship`).

## Rollback

1. Revert the two edited files (`lib/auth.ts`, `app/api/auth/[...nextauth]/route.ts`) to
   their template versions.
2. Delete `lib/account-lockout.ts`.
3. `npm uninstall @upstash/ratelimit @upstash/redis`.
4. Remove the 5 env vars. The Upstash database can be deleted from its console.

No schema/migration is involved, so rollback is code-only and instant.

## SECURITY.md rows to add

In **§2 (Authentication)**, under "Brute-force defense", append:

> **Account lockout (shared-tier):** `lib/account-lockout.ts` adds per-account lockout
> (`ACCOUNT_LOCKOUT_MAX_FAILS` fails within `ACCOUNT_LOCKOUT_WINDOW_SEC` → locked for
> `ACCOUNT_LOCKOUT_DURATION_SEC`), backed by Upstash Redis, wired into `lib/auth.ts`
> `authorize()`. The same Redis backs a shared-state per-IP limiter on `/api/auth/*`,
> replacing the in-memory bucket for multi-instance deployments (closes the cross-instance
> part of T-01).

In **§6 (Secrets)** table, add:

| Secret | Class | Where | Notes |
|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Confidential | Vercel env / `.env` | Upstash REST endpoint for the lockout/limiter store. |
| `UPSTASH_REDIS_REST_TOKEN` | Restricted | Vercel env / `.env` | Full read/write token for the Upstash DB. Rotate from the Upstash console. |

In **§16**, flip **row 4** ("Account lockout / brute-force throttle across instances") to
done, referencing `lib/account-lockout.ts`. In the **T-01** row of §11 (findings register),
note the cross-instance limiter is now available via this recipe.
