// Per-account brute-force lockout (OWASP A07; SECURITY.md §16 row 4).
//
// The per-IP limiter in `lib/rate-limit.ts` cannot express "N bad passwords for THIS
// account" — an attacker rotating IPs (or a botnet) stays under every IP bucket while
// hammering one email. This module counts failures per EMAIL and refuses further
// attempts once the threshold trips.
//
// Backends mirror `lib/rate-limit.ts` exactly, on the SAME primitives already shipped —
// no new dependency and no second Redis vendor (build-vs-buy ledger 2026-07-25):
//   - Valkey/Redis (shared across replicas) when VALKEY_URL/REDIS_URL is set (ADR-035),
//   - in-memory otherwise (the single-container default),
//   - and if Valkey is unreachable, `insuranceLimiter` degrades to in-memory rather than
//     failing OPEN — a lockout that silently stops locking is worse than useless.
//
// ACCEPTED TRADE-OFF: any account lockout is also a denial-of-service primitive — someone
// who knows an email can deliberately burn its attempts and lock the owner out. That is
// inherent to the control, not specific to this implementation. It is bounded here by
// making the lock TIME-BOXED (LOCK_SEC, default 15 min) rather than sticky-until-admin:
// the account self-heals, so the worst case is a delay, not a support ticket. A fork whose
// threat model prefers the opposite (sticky lock + explicit admin unlock) raises LOCK_SEC.
import { RateLimiterRedis, RateLimiterMemory } from "rate-limiter-flexible";
import { getValkey } from "./valkey";

/** Bad passwords tolerated inside the window before the account locks. */
const MAX_FAILS = Number(process.env.ACCOUNT_LOCKOUT_MAX_FAILS ?? 5);
/** Rolling window the failures are counted in (seconds). */
const WINDOW_SEC = Number(process.env.ACCOUNT_LOCKOUT_WINDOW_SEC ?? 900);
/** How long the account stays locked once tripped (seconds). */
const LOCK_SEC = Number(process.env.ACCOUNT_LOCKOUT_LOCK_SEC ?? 900);

const memoryLimiter = new RateLimiterMemory({
  points: MAX_FAILS,
  duration: WINDOW_SEC,
  blockDuration: LOCK_SEC,
});

let valkeyLimiter: RateLimiterRedis | null | undefined;

function limiter(): RateLimiterRedis | RateLimiterMemory {
  if (valkeyLimiter === undefined) {
    const store = getValkey();
    valkeyLimiter = store
      ? new RateLimiterRedis({
          storeClient: store,
          keyPrefix: "lockout",
          points: MAX_FAILS,
          duration: WINDOW_SEC,
          blockDuration: LOCK_SEC,
          insuranceLimiter: new RateLimiterMemory({
            points: MAX_FAILS,
            duration: WINDOW_SEC,
            blockDuration: LOCK_SEC,
          }),
        })
      : null;
  }
  return valkeyLimiter ?? memoryLimiter;
}

/** Normalize so casing/whitespace can't be used to sidestep the counter. */
function key(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Is this account currently locked out?
 *
 * Checked BEFORE the password comparison so a locked account can't be probed. Never
 * throws: an infrastructure fault must not become a login outage, so it degrades to
 * "not locked" and lets the per-IP limiter + password check stand (the in-memory
 * insurance limiter already covers the common Valkey-down case).
 */
export async function isAccountLocked(email: string): Promise<boolean> {
  try {
    const res = await limiter().get(key(email));
    return !!res && res.remainingPoints <= 0;
  } catch {
    return false;
  }
}

/**
 * Record one failed password attempt. Returns true if THIS failure tripped the lock.
 *
 * Counted for every email — including ones with no account — so the observable behaviour
 * is identical either way. Combined with `authorize()` returning `null` uniformly, this
 * leaks no signal about whether an account exists (the login path must stay
 * non-enumerable, matching the password-reset flow's posture).
 */
export async function recordFailedLogin(email: string): Promise<boolean> {
  try {
    await limiter().consume(key(email), 1);
    return false;
  } catch (err) {
    // rate-limiter-flexible REJECTS with the limiter result when points run out — that
    // rejection IS the lock tripping, not an error. Anything else is infrastructure.
    if (err && typeof err === "object" && "remainingPoints" in err) return true;
    return false;
  }
}

/** Clear the failure counter after a successful login. */
export async function clearFailedLogins(email: string): Promise<void> {
  try {
    await limiter().delete(key(email));
  } catch {
    /* best-effort: a stale counter expires on its own within the window */
  }
}
