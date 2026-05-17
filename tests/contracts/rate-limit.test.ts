import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "../../lib/rate-limit";

function req(ip = "1.2.3.4"): Request {
  return new Request("http://localhost/test", {
    headers: { "x-forwarded-for": ip },
  });
}

test("allows up to `limit` requests within the window", () => {
  const id = `rl-${Math.random()}`;
  for (let i = 0; i < 5; i++) {
    const r = rateLimit(req("10.0.0.1"), { id, limit: 5, windowMs: 60_000 });
    assert.equal(r.ok, true, `request ${i + 1} should pass`);
  }
});

test("blocks the (limit+1)th request and sets retryAfter > 0", () => {
  const id = `rl-${Math.random()}`;
  for (let i = 0; i < 3; i++) {
    rateLimit(req("10.0.0.2"), { id, limit: 3, windowMs: 60_000 });
  }
  const blocked = rateLimit(req("10.0.0.2"), { id, limit: 3, windowMs: 60_000 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfter > 0, "retryAfter must be positive");
});

test("separate buckets per `id` -- /auth limit does not affect /foo", () => {
  const ip = "10.0.0.3";
  for (let i = 0; i < 5; i++) {
    rateLimit(req(ip), { id: "auth", limit: 5, windowMs: 60_000 });
  }
  const blockedAuth = rateLimit(req(ip), { id: "auth", limit: 5, windowMs: 60_000 });
  assert.equal(blockedAuth.ok, false);

  const foo = rateLimit(req(ip), { id: "foo", limit: 5, windowMs: 60_000 });
  assert.equal(foo.ok, true);
});

test("separate buckets per client IP", () => {
  const id = `rl-${Math.random()}`;
  for (let i = 0; i < 5; i++) {
    rateLimit(req("10.0.0.4"), { id, limit: 5, windowMs: 60_000 });
  }
  const blocked = rateLimit(req("10.0.0.4"), { id, limit: 5, windowMs: 60_000 });
  assert.equal(blocked.ok, false);

  // Different IP still allowed
  const other = rateLimit(req("10.0.0.5"), { id, limit: 5, windowMs: 60_000 });
  assert.equal(other.ok, true);
});

test("x-real-ip is honored when x-forwarded-for is absent", () => {
  const id = `rl-${Math.random()}`;
  const realIpReq = new Request("http://localhost/test", {
    headers: { "x-real-ip": "172.16.0.1" },
  });
  const r = rateLimit(realIpReq, { id, limit: 1, windowMs: 60_000 });
  assert.equal(r.ok, true);
  const r2 = rateLimit(realIpReq, { id, limit: 1, windowMs: 60_000 });
  assert.equal(r2.ok, false);
});

test("window expiry resets the bucket", async () => {
  const id = `rl-${Math.random()}`;
  const r1 = rateLimit(req("10.0.0.6"), { id, limit: 1, windowMs: 10 });
  assert.equal(r1.ok, true);
  const r2 = rateLimit(req("10.0.0.6"), { id, limit: 1, windowMs: 10 });
  assert.equal(r2.ok, false);
  await new Promise((r) => setTimeout(r, 20));
  const r3 = rateLimit(req("10.0.0.6"), { id, limit: 1, windowMs: 10 });
  assert.equal(r3.ok, true, "bucket should reset after window");
});
