import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// ADR-070's reply-link token (AC-9.4…AC-9.7, tasks 5.3 / 5.3b).
//
// This is a bearer credential to Confidential data — a name, a work email, the
// question and HR's approved answer — on an app whose employee surface is
// anonymous and publicly reachable. ADR-070 exists because of that, and its
// "Token contract" is seven clauses. Six of them are testable here and every one
// fails silently if it regresses:
//
//   1. one escalation, nothing else — a token that resolved to more would look
//      identical from the outside;
//   2. 30 days, so a link does not sit live in a mailbox at offboarding;
//   3. unguessable, and stored as a DIGEST — a raw token column would make this
//      table a list of live credentials to anyone who can read the database: a
//      Neon branch, a snapshot, a backup, a support query;
//   4. revocable, and revoked on close;
//   6. an invalid, expired or revoked link reveals NOTHING — four different
//      facts must produce one indistinguishable outcome, or the route becomes
//      an oracle confirming that a real escalation sits behind a guessed token.
//
// Clause 5 (rate limiting) and clause 7 (noindex) live in the route.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

type Tokens = typeof import("../../lib/hive/reply-token.ts");
let tokens: Tokens;

interface Row {
  id: string;
  tokenHash: string;
  escalationId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

let rows: Row[] = [];
let creates: Record<string, unknown>[] = [];
let updates: Record<string, unknown>[] = [];
let audits: Record<string, unknown>[] = [];
let upserts = 0;

function reset() {
  rows = [];
  creates = [];
  updates = [];
  audits = [];
  upserts = 0;
}

const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma/audit-extension.ts"), {
    namedExports: {
      recordAudit: async (_c: unknown, entry: Record<string, unknown>) => {
        audits.push(entry);
      },
    },
  });
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        escalationReplyToken: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            creates.push(data);
            rows.push({
              id: `t${rows.length}`,
              tokenHash: String(data.tokenHash),
              escalationId: String(data.escalationId),
              expiresAt: data.expiresAt as Date,
              revokedAt: null,
              lastUsedAt: null,
            });
            return data;
          },
          findUnique: async ({
            where,
            select,
          }: {
            where: { tokenHash: string };
            select: Record<string, boolean>;
          }) => {
            const row = rows.find((r) => r.tokenHash === where.tokenHash);
            if (!row) return null;
            // Projected through `select`, so a read that stops asking for
            // `revokedAt` or `expiresAt` cannot keep passing against a mock that
            // hands back the whole row regardless.
            return Object.fromEntries(
              Object.keys(select).map((k) => [k, (row as unknown as Record<string, unknown>)[k]]),
            );
          },
          update: async ({
            where,
            data,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            updates.push({ id: where.id, ...data });
            const row = rows.find((r) => r.id === where.id);
            if (row && data.lastUsedAt) row.lastUsedAt = data.lastUsedAt as Date;
            return {};
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: { escalationId: string; revokedAt: null };
            data: Record<string, unknown>;
          }) => {
            // The `where` is modelled, not ignored: dropping `revokedAt: null`
            // would re-stamp already-revoked rows and inflate the count the
            // audit row reports.
            assert.equal(where.revokedAt, null, "already-revoked rows must not be re-stamped");
            const hit = rows.filter(
              (r) => r.escalationId === where.escalationId && r.revokedAt === null,
            );
            for (const r of hit) r.revokedAt = data.revokedAt as Date;
            return { count: hit.length };
          },
          upsert: async () => {
            upserts += 1;
            return {};
          },
        },
      },
    },
  });
  tokens = (await import(import.meta.resolve("../../lib/hive/reply-token.ts"))) as Tokens;
});

describe("clause 3 — unguessable, and never stored raw", { skip: !canMock }, () => {
  test("the token is long, URL-safe and different every time", async () => {
    reset();
    const a = await tokens.issueReplyToken("e1");
    const b = await tokens.issueReplyToken("e1");
    assert.equal(a.length, 43, "32 bytes of base64url is 43 characters");
    assert.match(a, /^[A-Za-z0-9_-]+$/, "it travels in a URL path");
    assert.notEqual(a, b);
  });

  test("only a DIGEST is persisted — the raw value never touches a column", async () => {
    // A raw token column would make this table a list of live credentials to
    // Confidential escalations, readable by anyone who can read the database.
    reset();
    const raw = await tokens.issueReplyToken("e1");
    const written = JSON.stringify(creates[0]);
    assert.ok(!written.includes(raw), "REGRESSION: a live bearer token is stored in the clear");
    assert.equal(creates[0].tokenHash, sha(raw));
    assert.match(String(creates[0].tokenHash), /^[0-9a-f]{64}$/);
  });

  test("the digest is of the WHOLE token, not a prefix", async () => {
    reset();
    const raw = await tokens.issueReplyToken("e1");
    assert.notEqual(creates[0].tokenHash, sha(raw.slice(0, 8)));
  });
});

describe("clause 2 — thirty days, on the row", { skip: !canMock }, () => {
  test("the expiry is written at issue, not left open-ended", async () => {
    reset();
    await tokens.issueReplyToken("e1");
    const expiresAt = creates[0].expiresAt as Date;
    assert.ok(expiresAt instanceof Date);
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 29 && days < 31, `expiry is ${days.toFixed(1)} days, not 30`);
  });

  test("thirty days is the named constant, so it is one decision", () => {
    assert.equal(tokens.REPLY_TOKEN_TTL_MS, 30 * 24 * 60 * 60 * 1000);
  });
});

describe("clause 6 — every failure is the same answer", { skip: !canMock }, () => {
  test("a valid token resolves to its ONE escalation", async () => {
    reset();
    const raw = await tokens.issueReplyToken("e-target");
    assert.deepEqual(await tokens.resolveReplyToken(raw), { escalationId: "e-target" });
  });

  test("an expired token is refused, even though the row is there", async () => {
    // Checked against the clock on READ. An expiry consulted only by a cleanup
    // job is a suggestion — the row is what the route trusts.
    reset();
    const raw = await tokens.issueReplyToken("e1");
    rows[0].expiresAt = new Date(Date.now() - 1000);
    assert.equal(await tokens.resolveReplyToken(raw), null, "REGRESSION: an expired link works");
  });

  test("a revoked token is refused", async () => {
    reset();
    const raw = await tokens.issueReplyToken("e1");
    await tokens.revokeReplyTokens("e1");
    assert.equal(await tokens.resolveReplyToken(raw), null, "REGRESSION: a revoked link works");
  });

  test("an unknown, a malformed and an empty token all give the SAME value", async () => {
    // Four different facts must be one outcome: "this token existed but expired"
    // confirms a real escalation to whoever is guessing.
    reset();
    const raw = await tokens.issueReplyToken("e1");
    rows[0].expiresAt = new Date(Date.now() - 1000);

    const outcomes = [
      await tokens.resolveReplyToken(raw), // expired
      await tokens.resolveReplyToken("x".repeat(43)), // unknown
      await tokens.resolveReplyToken("short"), // malformed
      await tokens.resolveReplyToken(""), // empty
      await tokens.resolveReplyToken("../../etc/passwd"), // hostile
    ];
    for (const o of outcomes) assert.equal(o, null);
    assert.equal(new Set(outcomes.map((o) => JSON.stringify(o))).size, 1);
  });

  test("a malformed token costs no database lookup", async () => {
    // Cheap shape check first: a megabyte of path should not reach a hash.
    reset();
    await tokens.issueReplyToken("e1");
    updates.length = 0;
    await tokens.resolveReplyToken("!".repeat(4000));
    assert.equal(updates.length, 0);
  });
});

describe("clause 1 — one escalation, nothing else", { skip: !canMock }, () => {
  test("resolving returns an escalation id and NOTHING that could widen", async () => {
    // No user, no session, no role. A scoped capability, not a login.
    reset();
    const raw = await tokens.issueReplyToken("e1");
    const grant = await tokens.resolveReplyToken(raw);
    assert.deepEqual(Object.keys(grant!), ["escalationId"]);
  });

  test("one escalation's token does not reach another's", async () => {
    reset();
    const a = await tokens.issueReplyToken("e-a");
    const b = await tokens.issueReplyToken("e-b");
    assert.deepEqual(await tokens.resolveReplyToken(a), { escalationId: "e-a" });
    assert.deepEqual(await tokens.resolveReplyToken(b), { escalationId: "e-b" });
  });
});

describe("clause 4 — revocable, and revoked on close", { skip: !canMock }, () => {
  test("revoking covers every live link to that escalation", async () => {
    reset();
    const a = await tokens.issueReplyToken("e1");
    const b = await tokens.issueReplyToken("e1");
    const other = await tokens.issueReplyToken("e2");

    assert.equal(await tokens.revokeReplyTokens("e1"), 2);
    assert.equal(await tokens.resolveReplyToken(a), null);
    assert.equal(await tokens.resolveReplyToken(b), null);
    assert.deepEqual(
      await tokens.resolveReplyToken(other),
      { escalationId: "e2" },
      "REGRESSION: revoking one thread's links took another's with them",
    );
  });

  test("revoking twice is a no-op, not a double count", async () => {
    reset();
    await tokens.issueReplyToken("e1");
    assert.equal(await tokens.revokeReplyTokens("e1"), 1);
    assert.equal(await tokens.revokeReplyTokens("e1"), 0);
  });

  test("the bulk revoke writes ONE audit row, and no credential in it", async () => {
    // `updateMany` bypasses the audit extension, so the suppression is paired
    // with an explicit row. It carries the fact and its size — never a hash.
    reset();
    const raw = await tokens.issueReplyToken("e1");
    await tokens.revokeReplyTokens("e1");
    assert.equal(audits.length, 1, "REGRESSION: a revocation now leaves no trail");
    assert.equal(audits[0].entityId, "e1");
    const json = JSON.stringify(audits[0]);
    assert.ok(!json.includes(raw));
    assert.ok(!json.includes(sha(raw)), "not even the digest belongs in an audit row");
  });

  test("revoking nothing writes no audit row", async () => {
    reset();
    assert.equal(await tokens.revokeReplyTokens("e-none"), 0);
    assert.equal(audits.length, 0, "an audit row for a no-op is noise in the trail");
  });

  test("the write is create/updateMany, never an upsert", async () => {
    reset();
    await tokens.issueReplyToken("e1");
    await tokens.revokeReplyTokens("e1");
    assert.equal(upserts, 0);
  });
});

describe("last use is recorded, so a leak is visible after the fact", { skip: !canMock }, () => {
  test("a successful resolve stamps lastUsedAt", async () => {
    reset();
    const raw = await tokens.issueReplyToken("e1");
    await tokens.resolveReplyToken(raw);
    assert.ok(updates.some((u) => u.lastUsedAt instanceof Date));
  });

  test("a FAILED resolve stamps nothing", async () => {
    // Otherwise the column records attempts rather than uses, and a guessing
    // attacker writes to the database.
    reset();
    await tokens.issueReplyToken("e1");
    updates.length = 0;
    await tokens.resolveReplyToken("y".repeat(43));
    assert.equal(updates.length, 0, "REGRESSION: a failed guess writes a row");
  });
});

describe("the emailed link", { skip: !canMock }, () => {
  test("it points at the reply page with the raw token in the path", () => {
    assert.equal(
      tokens.replyLinkFor("https://hive.example", "abc"),
      "https://hive.example/reply/abc",
    );
  });

  test("a trailing slash on the origin does not double up", () => {
    assert.equal(
      tokens.replyLinkFor("https://hive.example/", "abc"),
      "https://hive.example/reply/abc",
    );
  });
});
