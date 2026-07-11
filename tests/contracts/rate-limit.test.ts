import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "../../lib/rate-limit";

// These exercise the in-memory backend (the default; no VALKEY_URL in the test
// env). rateLimit() is async since the shared-state (Valkey) path is a network
// round-trip, so every call is awaited even on the synchronous in-memory path.

function req(ip = "1.2.3.4"): Request {
  return new Request("http://localhost/test", {
    headers: { "x-forwarded-for": ip },
  });
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

test("separate buckets per client IP", async () => {
  const id = `rl-${Math.random()}`;
  for (let i = 0; i < 5; i++) {
    await rateLimit(req("10.0.0.4"), { id, limit: 5, windowMs: 60_000 });
  }
  const blocked = await rateLimit(req("10.0.0.4"), { id, limit: 5, windowMs: 60_000 });
  assert.equal(blocked.ok, false);

  // Different IP still allowed
  const other = await rateLimit(req("10.0.0.5"), { id, limit: 5, windowMs: 60_000 });
  assert.equal(other.ok, true);
});

test("x-real-ip is honored when x-forwarded-for is absent", async () => {
  const id = `rl-${Math.random()}`;
  const realIpReq = new Request("http://localhost/test", {
    headers: { "x-real-ip": "172.16.0.1" },
  });
  const r = await rateLimit(realIpReq, { id, limit: 1, windowMs: 60_000 });
  assert.equal(r.ok, true);
  const r2 = await rateLimit(realIpReq, { id, limit: 1, windowMs: 60_000 });
  assert.equal(r2.ok, false);
});

test("x-real-ip is preferred over a (spoofable) x-forwarded-for[0]", async () => {
  const id = `rl-${Math.random()}`;
  // Same trusted x-real-ip, but different spoofed XFF each call: both must land
  // in the SAME bucket (keyed by x-real-ip), so the 2nd is blocked at limit 1.
  const mk = (spoof: string) =>
    new Request("http://localhost/test", {
      headers: { "x-forwarded-for": spoof, "x-real-ip": "203.0.113.9" },
    });
  assert.equal((await rateLimit(mk("1.1.1.1"), { id, limit: 1, windowMs: 60_000 })).ok, true);
  assert.equal(
    (await rateLimit(mk("2.2.2.2"), { id, limit: 1, windowMs: 60_000 })).ok,
    false,
    "rotating the spoofable XFF must NOT escape the x-real-ip bucket",
  );
});

test("RATE_LIMIT_TRUSTED_IP_HEADER, when set, is trusted over x-real-ip / XFF", async () => {
  const id = `rl-${Math.random()}`;
  const prev = process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  process.env.RATE_LIMIT_TRUSTED_IP_HEADER = "cf-connecting-ip";
  try {
    const mk = (cf: string) =>
      new Request("http://localhost/test", {
        headers: {
          "cf-connecting-ip": cf,
          "x-real-ip": "10.9.9.9",
          "x-forwarded-for": "8.8.8.8",
        },
      });
    // Keyed by cf-connecting-ip: different value -> different bucket.
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
  } finally {
    if (prev === undefined) delete process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
    else process.env.RATE_LIMIT_TRUSTED_IP_HEADER = prev;
  }
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
