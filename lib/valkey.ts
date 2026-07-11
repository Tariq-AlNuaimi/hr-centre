import Redis, { type Redis as RedisClient } from "ioredis";

// Lazy singleton Valkey/Redis client for shared-state features (rate limiting;
// ADR-035, build-vs-buy-ledger 2026-07-11). Returns null when no VALKEY_URL /
// REDIS_URL is configured -- the single-container default, where callers fall
// back to in-memory. Valkey is the BSD-licensed Redis fork (Redis relicensed off
// OSS in 2024) and speaks the same wire protocol, so ioredis connects to either.
//
// Connection errors are swallowed here so a Valkey outage degrades gracefully
// (the rate limiter's insuranceLimiter takes over) instead of crashing request
// handling with an unhandled 'error' event.

let client: RedisClient | null | undefined;

export function getValkey(): RedisClient | null {
  if (client !== undefined) return client;
  const url = process.env.VALKEY_URL ?? process.env.REDIS_URL ?? "";
  if (!url) {
    client = null;
    return null;
  }
  const c = new Redis(url, {
    // Fail fast and degrade to the insurance limiter rather than queueing
    // requests forever when Valkey is unreachable.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  // Keep an outage from raising an unhandled 'error' and killing the process.
  c.on("error", () => {});
  client = c;
  return client;
}
