import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";

// ADR-070's PUBLIC reply route — clauses 5, 6 and 7 of the token contract.
//
// This is the seventh and last of ADR-068's enumerated public routes, and the
// only one that hands back Confidential data (§1: a name, a question, HR's
// approved answer) on the strength of a string in a URL. Three things contain
// that, and each of them fails silently:
//
//   - **clause 5, rate limiting per TOKEN as well as per IP.** ~300 employees
//     share one office egress address, so a tight per-IP limit throttles the
//     company and a loose one is no limit at all. The token is the only identity
//     an attacker cannot rotate for free.
//   - **clause 6, one answer for every failure.** Malformed, unknown, expired
//     and revoked must be indistinguishable, or the route confirms that a real
//     escalation sits behind a guessed token.
//   - **clause 7, `noindex` and `Cache-Control: private`.** The token lands in
//     browser history and, on some clients, a Referer. A cached or indexed copy
//     of the response outlives the token entirely.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

type Route = typeof import("../../app/api/hive/reply/[token]/route.ts");
let route: Route;

const VALID = "v".repeat(43);

let buckets: { id: string; key: string; limit: number }[] = [];
let exhausted = new Set<string>();
let grant: { escalationId: string } | null = { escalationId: "e1" };
let appendOutcome: Record<string, unknown> = { ok: true, status: "IN_PROGRESS" };
let appended: string[] = [];
/** How many times the route asked the resolver — the shape check must precede it. */
let resolveCalls = 0;

function reset() {
  buckets = [];
  exhausted = new Set();
  grant = { escalationId: "e1" };
  appendOutcome = { ok: true, status: "IN_PROGRESS" };
  appended = [];
  resolveCalls = 0;
}

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/rate-limit.ts"), {
    namedExports: {
      rateLimit: async (req: Request, opts: { id: string; limit: number }) => {
        buckets.push({ id: opts.id, key: req.headers.get("x-real-ip") ?? "?", limit: opts.limit });
        return { ok: !exhausted.has(opts.id), remaining: 0, retryAfter: 60 };
      },
    },
  });
  mockApi.module!(import.meta.resolve("../../lib/hive/reply-token.ts"), {
    namedExports: {
      resolveReplyToken: async () => {
        resolveCalls += 1;
        return grant;
      },
      issueReplyToken: async () => "x",
      replyLinkFor: () => "x",
      revokeReplyTokens: async () => 0,
      REPLY_TOKEN_TTL_MS: 1,
    },
  });
  mockApi.module!(import.meta.resolve("../../lib/hive/services/reply.ts"), {
    namedExports: {
      loadReplyThread: async () => null,
      appendReply: async (_id: string, body: string) => {
        appended.push(body);
        return appendOutcome;
      },
    },
  });
  route = (await import(import.meta.resolve("../../app/api/hive/reply/[token]/route.ts"))) as Route;
});

const ctx = (token = VALID) => ({ params: Promise.resolve({ token }) }) as never;
const post = (body: unknown) =>
  new Request("https://h/api/hive/reply/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

describe("there is no GET — the thread is rendered server-side", { skip: !canMock }, () => {
  test("only POST is exported", () => {
    // A JSON copy of a Confidential thread on a public endpoint, with no reader,
    // is surface kept because a route table said so. The page resolves the token
    // itself.
    assert.equal(typeof route.POST, "function");
    assert.equal(
      (route as Record<string, unknown>).GET,
      undefined,
      "REGRESSION: a public read endpoint for Confidential data reappeared",
    );
  });
});

describe("clause 6 — every failure is the same 404", { skip: !canMock }, () => {
  test("a valid token appends and returns 200", async () => {
    reset();
    assert.equal((await route.POST(post({ body: "hi" }), ctx())).status, 200);
  });

  test("an unresolvable token is 404", async () => {
    reset();
    grant = null;
    assert.equal((await route.POST(post({ body: "hi" }), ctx())).status, 404);
  });

  test("a malformed token is the SAME 404, body included", async () => {
    // A different status or a different message would tell a guesser which of
    // their attempts hit a real escalation.
    reset();
    grant = null;
    const unresolvable = await route.POST(post({ body: "hi" }), ctx());
    reset();
    const malformed = await route.POST(post({ body: "hi" }), ctx("short"));
    assert.equal(malformed.status, unresolvable.status);
    assert.equal(await malformed.text(), await unresolvable.text());
  });

  test("a malformed token never reaches the resolver", async () => {
    // The shape check is first so a megabyte of path costs no lookup — and, on
    // a public route, so a flood of junk cannot be turned into database load.
    reset();
    await route.POST(post({ body: "hi" }), ctx("!".repeat(200)));
    assert.equal(resolveCalls, 0, "REGRESSION: a malformed token reaches the database");

    // ...and a well-formed one does, so the check above is not passing because
    // the resolver is never called at all.
    await route.POST(post({ body: "hi" }), ctx());
    assert.equal(resolveCalls, 1);
  });
});

describe("clause 5 — two keys, and the tight one is the TOKEN", { skip: !canMock }, () => {
  test("the per-token bucket is keyed on the token, not the caller's IP", async () => {
    // ~300 employees share one office egress address. The token is the only
    // identity an attacker cannot rotate for free.
    reset();
    await route.POST(post({ body: "hi" }), ctx());
    const perToken = buckets.find((b) => b.id === "hive-reply-write");
    assert.ok(perToken, "REGRESSION: there is no per-token limit");
    assert.equal(perToken!.key, VALID, "REGRESSION: the tight limit is keyed on the IP");
  });

  test("the per-IP bucket is LOOSER than the per-token one", async () => {
    // A tight per-IP limit throttles the whole company rather than an abuser.
    reset();
    await route.POST(post({ body: "hi" }), ctx());
    const perToken = buckets.find((b) => b.id === "hive-reply-write")!;
    const perIp = buckets.find((b) => b.id === "hive-reply-write-ip")!;
    assert.ok(perIp, "REGRESSION: the per-IP backstop is gone");
    assert.ok(
      perIp.limit > perToken.limit,
      "an office-wide bucket at the per-token number is a company-wide outage",
    );
  });

  test("a spent WRITE budget appends nothing", async () => {
    reset();
    exhausted = new Set(["hive-reply-write"]);
    const res = await route.POST(post({ body: "hello" }), ctx());
    assert.equal(res.status, 429);
    assert.deepEqual(appended, []);
  });
});

describe("clause 7 — this response does not travel", { skip: !canMock }, () => {
  for (const [label, call] of [
    ["an accepted follow-up", () => route.POST(post({ body: "hi" }), ctx())],
    ["a 404", () => route.POST(post({ body: "hi" }), ctx("short"))],
  ] as const) {
    test(`${label} carries noindex and no-store`, async () => {
      // The token is in browser history and, on some clients, a Referer. A
      // cached or indexed copy of this outlives the token entirely.
      reset();
      const res = await call();
      assert.match(res.headers.get("Cache-Control") ?? "", /no-store/);
      assert.match(res.headers.get("Cache-Control") ?? "", /private/);
      assert.match(res.headers.get("X-Robots-Tag") ?? "", /noindex/);
    });
  }
});

describe("the write path", { skip: !canMock }, () => {
  test("a valid follow-up is appended", async () => {
    reset();
    const res = await route.POST(post({ body: "one more thing" }), ctx());
    assert.equal(res.status, 200);
    assert.deepEqual(appended, ["one more thing"]);
  });

  test("an empty body is a 400 and appends nothing", async () => {
    reset();
    assert.equal((await route.POST(post({ body: "   " }), ctx())).status, 400);
    assert.deepEqual(appended, []);
  });

  test("a body over the chat limit is refused", async () => {
    reset();
    assert.equal((await route.POST(post({ body: "x".repeat(20_000) }), ctx())).status, 400);
    assert.deepEqual(appended, []);
  });

  test("a missing body is a 400, not a 500", async () => {
    reset();
    assert.equal((await route.POST(post({}), ctx())).status, 400);
  });

  test("a closed or over-quota thread comes back as the same 404", async () => {
    // The service distinguishes them; the route deliberately does not, for the
    // same reason the token failures collapse.
    reset();
    appendOutcome = { error: "closed" };
    const closed = await route.POST(post({ body: "hi" }), ctx());
    reset();
    appendOutcome = { error: "too_many" };
    const tooMany = await route.POST(post({ body: "hi" }), ctx());
    assert.equal(closed.status, 404);
    assert.equal(tooMany.status, 404);
    assert.equal(await closed.text(), await tooMany.text());
  });

  test("a malformed body is refused BEFORE the token is resolved", async () => {
    // A bad body earns its 400 whether or not the escalation exists, which is
    // one fewer way to learn that it does.
    reset();
    grant = null;
    assert.equal((await route.POST(post({ body: "" }), ctx())).status, 400);
  });
});
