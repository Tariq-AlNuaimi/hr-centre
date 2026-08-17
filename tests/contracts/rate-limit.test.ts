import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "../../lib/rate-limit";

// These exercise the in-memory backend (the default; no VALKEY_URL in the test
// env). rateLimit() is async since the shared-state (Valkey) path is a network
// round-trip, so every call is awaited even on the synchronous in-memory path.
//
// CLIENT-IP CONTRACT (red-team R1, 2026-08-17). lib/client-ip.ts fails CLOSED:
// no forwarding header is trusted unless RATE_LIMIT_TRUSTED_IP_HEADER names it.
// The tests below are split accordingly:
//   - UNCONFIGURED  -> every request shares the "unknown" bucket. Strict, and
//                      critically NOT escapable by rotating a header.
//   - CONFIGURED    -> only the named header keys the bucket; every other
//                      forwarding header is ignored even if present.
// The previous suite asserted "x-real-ip is honored" and "x-real-ip is preferred
// over XFF" -- that WAS the vulnerability (Caddy does not set X-Real-IP, so a
// client could supply it), so those expectations are inverted here on purpose.

/** A request carrying spoofable forwarding headers and nothing trustworthy. */
function req(ip = "1.2.3.4"): Request {
  return new Request("http://localhost/test", {
    headers: { "x-forwarded-for": ip },
  });
}

/** Run `fn` with RATE_LIMIT_TRUSTED_IP_HEADER set, restoring it afterwards. */
async function withTrustedHeader(name: string, fn: () => Promise<void>) {
  const prev = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  process.env.RATE_LIMIT_TRUSTED_IP_HEADER = name;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
    else process.env.RATE_LIMIT_TRUSTED_IP_HEADER = prev;
  }
}

test("allows up to `limit` requests within the window", async () => {
  const id = `rl-${Math.random()}`;
  for (let i = 0; i < 5; i++) {
    const r = await rateLimit(req("10.0.0.1"), { id, limit: 5, windowMs: 60_000 });
    assert.equal(r.ok, true, `request ${i + 1} should pass`);
  }
});

test("blocks the (limit+1)th request and sets retryAfter > 0", async () => {
  const id = `rl-${Math.random()}`;
  for (let i = 0; i < 3; i++) {
    await rateLimit(req("10.0.0.2"), { id, limit: 3, windowMs: 60_000 });
  }
  const blocked = await rateLimit(req("10.0.0.2"), { id, limit: 3, windowMs: 60_000 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfter > 0, "retryAfter must be positive");
});

test("separate buckets per `id` -- /auth limit does not affect /foo", async () => {
  const ip = "10.0.0.3";
  for (let i = 0; i < 5; i++) {
    await rateLimit(req(ip), { id: "auth", limit: 5, windowMs: 60_000 });
  }
  const blockedAuth = await rateLimit(req(ip), { id: "auth", limit: 5, windowMs: 60_000 });
  assert.equal(blockedAuth.ok, false);

  const foo = await rateLimit(req(ip), { id: "foo", limit: 5, windowMs: 60_000 });
  assert.equal(foo.ok, true);
});

// --- R1 regression: the exploit, now closed ---------------------------------

test("R1: rotating x-real-ip does NOT escape the bucket when unconfigured", async () => {
  const id = `rl-${Math.random()}`;
  const mk = (spoof: string) =>
    new Request("http://localhost/test", { headers: { "x-real-ip": spoof } });

  assert.equal((await rateLimit(mk("203.0.113.1"), { id, limit: 1, windowMs: 60_000 })).ok, true);
  assert.equal(
    (await rateLimit(mk("203.0.113.2"), { id, limit: 1, windowMs: 60_000 })).ok,
    false,
    "a fresh x-real-ip must NOT mint a fresh bucket -- that was the R1 bypass",
  );
});

test("R1: rotating x-forwarded-for does NOT escape the bucket when unconfigured", async () => {
  const id = `rl-${Math.random()}`;
  assert.equal((await rateLimit(req("198.51.100.1"), { id, limit: 1, windowMs: 60_000 })).ok, true);
  assert.equal(
    (await rateLimit(req("198.51.100.2"), { id, limit: 1, windowMs: 60_000 })).ok,
    false,
    "a fresh XFF must NOT mint a fresh bucket",
  );
});

test("R1: unconfigured deployments share one bucket -- strict, never bypassable", async () => {
  const id = `rl-${Math.random()}`;
  // Two entirely different clients, no trusted header configured: they share the
  // "unknown" bucket. Throttling HARDER than per-IP is the correct direction to
  // fail; the wrong direction is letting a header mint unlimited buckets.
  await rateLimit(req("10.0.0.4"), { id, limit: 1, windowMs: 60_000 });
  const other = await rateLimit(req("10.0.0.5"), { id, limit: 1, windowMs: 60_000 });
  assert.equal(other.ok, false, "unattributable requests must share one bucket");
});

// --- configured behaviour ----------------------------------------------------

test("the named trusted header keys the bucket, and only it", async () => {
  const id = `rl-${Math.random()}`;
  await withTrustedHeader("cf-connecting-ip", async () => {
    const mk = (cf: string) =>
      new Request("http://localhost/test", {
        headers: {
          "cf-connecting-ip": cf,
          "x-real-ip": "10.9.9.9",
          "x-forwarded-for": "8.8.8.8",
        },
      });
    assert.equal(
      (await rateLimit(mk("198.51.100.1"), { id, limit: 1, windowMs: 60_000 })).ok,
      true,
    );
    assert.equal(
      (await rateLimit(mk("198.51.100.1"), { id, limit: 1, windowMs: 60_000 })).ok,
      false,
    );
    assert.equal(
      (await rateLimit(mk("198.51.100.2"), { id, limit: 1, windowMs: 60_000 })).ok,
      true,
      "a different cf-connecting-ip is a different bucket",
    );
  });
});

test("when x-real-ip IS the declared trusted header, a rotating XFF cannot escape", async () => {
  const id = `rl-${Math.random()}`;
  await withTrustedHeader("x-real-ip", async () => {
    // The Caddy/nginx/Vercel topology: the proxy guarantees x-real-ip, so it is
    // trusted; XFF stays client-controlled and must be ignored.
    const mk = (spoof: string) =>
      new Request("http://localhost/test", {
        headers: { "x-forwarded-for": spoof, "x-real-ip": "203.0.113.9" },
      });
    assert.equal((await rateLimit(mk("1.1.1.1"), { id, limit: 1, windowMs: 60_000 })).ok, true);
    assert.equal(
      (await rateLimit(mk("2.2.2.2"), { id, limit: 1, windowMs: 60_000 })).ok,
      false,
      "rotating the spoofable XFF must NOT escape the trusted x-real-ip bucket",
    );
  });
});

test("a missing trusted header falls back to the shared bucket, not to XFF", async () => {
  const id = `rl-${Math.random()}`;
  await withTrustedHeader("cf-connecting-ip", async () => {
    // Trusted header absent but XFF present: XFF must NOT be consulted.
    assert.equal((await rateLimit(req("172.16.0.1"), { id, limit: 1, windowMs: 60_000 })).ok, true);
    assert.equal(
      (await rateLimit(req("172.16.0.2"), { id, limit: 1, windowMs: 60_000 })).ok,
      false,
      "absent trusted header must not silently fall back to a spoofable one",
    );
  });
});

test("window expiry resets the bucket", async () => {
  const id = `rl-${Math.random()}`;
  const r1 = await rateLimit(req("10.0.0.6"), { id, limit: 1, windowMs: 10 });
  assert.equal(r1.ok, true);
  const r2 = await rateLimit(req("10.0.0.6"), { id, limit: 1, windowMs: 10 });
  assert.equal(r2.ok, false);
  await new Promise((r) => setTimeout(r, 20));
  const r3 = await rateLimit(req("10.0.0.6"), { id, limit: 1, windowMs: 10 });
  assert.equal(r3.ok, true, "bucket should reset after window");
});
