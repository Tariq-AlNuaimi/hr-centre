import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "../../lib/rate-limit";
import { ipTrustIsConfigured } from "../../lib/client-ip";

// These exercise the in-memory backend (the default; no VALKEY_URL in the test
// env). rateLimit() is async since the shared-state (Valkey) path is a network
// round-trip, so every call is awaited even on the synchronous in-memory path.
//
// CLIENT-IP CONTRACT (red-team R1, 2026-08-17). lib/client-ip.ts fails CLOSED:
// no forwarding header is trusted unless RATE_LIMIT_TRUSTED_IP_HEADER names it.
// The tests below are split accordingly:
//   - CONFIGURED    -> only the named header keys the bucket; every other
//                      forwarding header is ignored even if present.
//   - UNCONFIGURED  -> the client-supplied header still PARTITIONS the buckets,
//                      marked `untrusted:` so it can never collide with a trusted
//                      key. Rotating it evades your own throttle; it cannot drag
//                      anyone else into your bucket.
//
// That second bullet is the reverse of what this suite asserted between
// 2026-08-17 and review round 8, and the flip is deliberate. The strict version
// keyed everything unattributable into one shared "unknown" bucket, which read as
// "throttles harder, the safe direction to fail" -- but auth buckets are small
// (login 10/min, reset 5/min) and process-wide, so eleven requests from one
// stranger locked EVERY user out of signing in. Header spoofing costs the spoofer
// their own throttle; a shared bucket costs everyone the application. Attribution
// (audit_logs.ipAddress, via clientIp) still fails closed -- a forged forensic
// record is worse than an absent one. Only throttling changed.

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

// --- unconfigured: partition, never collapse (review round 8) ----------------

test("rotating x-real-ip mints its own bucket when unconfigured -- and only its own", async () => {
  const id = `rl-${Math.random()}`;
  const mk = (spoof: string) =>
    new Request("http://localhost/test", { headers: { "x-real-ip": spoof } });

  assert.equal((await rateLimit(mk("203.0.113.1"), { id, limit: 1, windowMs: 60_000 })).ok, true);
  assert.equal(
    (await rateLimit(mk("203.0.113.1"), { id, limit: 1, windowMs: 60_000 })).ok,
    false,
    "the same claimed IP must reuse its bucket",
  );
  assert.equal(
    (await rateLimit(mk("203.0.113.2"), { id, limit: 1, windowMs: 60_000 })).ok,
    true,
    "a different claimed IP gets a different bucket -- evasion by the spoofer, " +
      "not an outage for everyone else",
  );
});

test("one caller's flood cannot exhaust another caller's bucket when unconfigured", async () => {
  // The DoS this replaced: two unrelated clients used to share the `unknown`
  // bucket, so either one could lock the other out of /api/auth with a handful
  // of requests. This is the regression test for that outage.
  const id = `rl-${Math.random()}`;
  for (let i = 0; i < 10; i++) {
    await rateLimit(req("10.0.0.4"), { id, limit: 3, windowMs: 60_000 });
  }
  const victim = await rateLimit(req("10.0.0.5"), { id, limit: 3, windowMs: 60_000 });
  assert.equal(victim.ok, true, "a second client must not inherit the first client's exhaustion");
});

test("an untrusted claim cannot collide with a trusted bucket", async () => {
  // An attacker who sends `X-Real-IP: <victim>` while the deployment trusts
  // cf-connecting-ip must land in `untrusted:<victim>`, not in the victim's
  // `ip:<victim>` bucket -- otherwise the prefix would not be buying anything.
  const id = `rl-${Math.random()}`;
  await withTrustedHeader("cf-connecting-ip", async () => {
    const victim = new Request("http://localhost/test", {
      headers: { "cf-connecting-ip": "192.0.2.7" },
    });
    const attacker = new Request("http://localhost/test", {
      headers: { "x-real-ip": "192.0.2.7" },
    });
    assert.equal((await rateLimit(attacker, { id, limit: 1, windowMs: 60_000 })).ok, true);
    assert.equal(
      (await rateLimit(attacker, { id, limit: 1, windowMs: 60_000 })).ok,
      false,
      "attacker exhausts their own untrusted bucket",
    );
    assert.equal(
      (await rateLimit(victim, { id, limit: 1, windowMs: 60_000 })).ok,
      true,
      "the victim's trusted bucket is untouched",
    );
  });
});

test("a request with no forwarding headers at all shares the unattributed bucket", async () => {
  // Nothing is knowable here (a direct connection -- local dev, or a container
  // reached without a proxy). One shared bucket is the only option; it is not an
  // internet-facing shape, so the collapse is acceptable HERE and nowhere else.
  const id = `rl-${Math.random()}`;
  const bare = () => new Request("http://localhost/test");
  assert.equal((await rateLimit(bare(), { id, limit: 1, windowMs: 60_000 })).ok, true);
  assert.equal((await rateLimit(bare(), { id, limit: 1, windowMs: 60_000 })).ok, false);
});

// --- subject-keyed buckets ---------------------------------------------------

test("the subject bucket caps one account across rotating IPs", async () => {
  // This is the control that survives header rotation: the IP key is fresh every
  // request, so only the account-keyed bucket stops a distributed run.
  const id = `rl-${Math.random()}`;
  const opts = { id, limit: 2, windowMs: 60_000, subject: "victim@example.com" };
  assert.equal((await rateLimit(req("10.1.0.1"), opts)).ok, true);
  assert.equal((await rateLimit(req("10.1.0.2"), opts)).ok, true);
  assert.equal(
    (await rateLimit(req("10.1.0.3"), opts)).ok,
    false,
    "a third IP must still hit the account's own quota",
  );
});

test("subject buckets do not leak across accounts", async () => {
  const id = `rl-${Math.random()}`;
  const base = { id, limit: 1, windowMs: 60_000 };
  assert.equal((await rateLimit(req("10.2.0.1"), { ...base, subject: "a@x.com" })).ok, true);
  assert.equal(
    (await rateLimit(req("10.2.0.2"), { ...base, subject: "b@x.com" })).ok,
    true,
    "a different account is a different bucket",
  );
});

test("the subject key is case- and whitespace-insensitive", async () => {
  const id = `rl-${Math.random()}`;
  const base = { id, limit: 1, windowMs: 60_000 };
  assert.equal((await rateLimit(req("10.3.0.1"), { ...base, subject: "Sam@X.com" })).ok, true);
  assert.equal(
    (await rateLimit(req("10.3.0.2"), { ...base, subject: "  sam@x.com " })).ok,
    false,
    "normalising the subject stops trivial casing/padding variants minting buckets",
  );
});

test("ipTrustIsConfigured reports the unconfigured state", async () => {
  assert.equal(ipTrustIsConfigured(), false, "no trusted header and not on Vercel in tests");
  await withTrustedHeader("cf-connecting-ip", async () => {
    assert.equal(ipTrustIsConfigured(), true);
  });
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

test("a missing trusted header degrades to an untrusted key, not to a shared bucket", async () => {
  const id = `rl-${Math.random()}`;
  await withTrustedHeader("cf-connecting-ip", async () => {
    // Trusted header absent (a request that bypassed the CDN, or a misconfigured
    // proxy) but XFF present. The XFF must not be treated as TRUSTED -- and the
    // untrusted-bucket test above proves it cannot collide with one -- but it
    // must still partition, or a single bypassing client takes the app down.
    assert.equal((await rateLimit(req("172.16.0.1"), { id, limit: 1, windowMs: 60_000 })).ok, true);
    assert.equal(
      (await rateLimit(req("172.16.0.2"), { id, limit: 1, windowMs: 60_000 })).ok,
      true,
      "a distinct client must not inherit another client's exhaustion",
    );
    assert.equal(
      (await rateLimit(req("172.16.0.1"), { id, limit: 1, windowMs: 60_000 })).ok,
      false,
      "...but each claimed value is still capped",
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
