import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// ADR-090: the core magic-link primitive every public link uses. The ticket
// binding's clauses are tested in hive-reply-token.test.ts; this file pins what
// the core adds — purpose isolation — and the pure helpers.

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

type Core = typeof import("../../lib/core/tokens/magic-link.ts");
let core: Core;

interface Row {
  id: string;
  purpose: string;
  subjectId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}
let rows: Row[] = [];
let stamps = 0;

before(async () => {
  if (!canMock) return;
  mockApi.module!(import.meta.resolve("../../lib/prisma/audit-extension.ts"), {
    namedExports: { recordAudit: async () => undefined },
  });
  mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
    namedExports: {
      prisma: {
        magicLink: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            rows.push({
              id: `m${rows.length}`,
              purpose: String(data.purpose),
              subjectId: String(data.subjectId),
              tokenHash: String(data.tokenHash),
              expiresAt: data.expiresAt as Date,
              revokedAt: null,
            });
            return {};
          },
          findUnique: async ({ where }: { where: { tokenHash: string } }) =>
            rows.find((r) => r.tokenHash === where.tokenHash) ?? null,
          update: async () => {
            stamps += 1;
            return {};
          },
          updateMany: async ({
            where,
          }: {
            where: { purpose: string; subjectId: string; revokedAt: null };
          }) => {
            const hit = rows.filter(
              (r) => r.purpose === where.purpose && r.subjectId === where.subjectId && !r.revokedAt,
            );
            for (const r of hit) r.revokedAt = new Date();
            return { count: hit.length };
          },
        },
      },
    },
  });
  core = (await import(import.meta.resolve("../../lib/core/tokens/magic-link.ts"))) as Core;
});

describe("pure helpers", { skip: !canMock }, () => {
  test("a raw token is 43 URL-safe characters and its digest is SHA-256 hex", () => {
    const raw = core.mintRawToken();
    assert.ok(core.isTokenShaped(raw));
    assert.equal(core.digestToken(raw), createHash("sha256").update(raw).digest("hex"));
  });

  test("shape check refuses anything that is not a token", () => {
    for (const v of ["", "short", "!".repeat(43), "a".repeat(44), "../../etc/passwd"]) {
      assert.equal(core.isTokenShaped(v), false, v);
    }
  });

  test("a link is live only when unrevoked and before its expiry", () => {
    const now = new Date("2026-10-29T10:00:00Z");
    const future = new Date("2026-10-30T10:00:00Z");
    assert.equal(core.isLinkLive({ expiresAt: future, revokedAt: null }, now), true);
    assert.equal(core.isLinkLive({ expiresAt: now, revokedAt: null }, now), false);
    assert.equal(core.isLinkLive({ expiresAt: future, revokedAt: now }, now), false);
  });

  test("the emailed URL joins origin, path and token without doubled slashes", () => {
    assert.equal(
      core.magicLinkUrl("https://x.example/", "/reply/", "t"),
      "https://x.example/reply/t",
    );
  });
});

describe("purpose isolation", { skip: !canMock }, () => {
  test("a link minted for one purpose never resolves for another", async () => {
    rows = [];
    const raw = await core.issueMagicLink({ purpose: "a.one", subjectId: "s1", ttlMs: 60_000 });
    assert.deepEqual(await core.resolveMagicLink("a.one", raw), { subjectId: "s1" });
    stamps = 0;
    assert.equal(await core.resolveMagicLink("b.two", raw), null);
    assert.equal(stamps, 0, "a wrong-purpose attempt writes nothing");
  });

  test("revoking one purpose leaves another purpose's link to the same id alone", async () => {
    rows = [];
    const a = await core.issueMagicLink({ purpose: "a.one", subjectId: "s1", ttlMs: 60_000 });
    const b = await core.issueMagicLink({ purpose: "b.two", subjectId: "s1", ttlMs: 60_000 });
    assert.equal(await core.revokeMagicLinks("a.one", "s1"), 1);
    assert.equal(await core.resolveMagicLink("a.one", a), null);
    assert.deepEqual(await core.resolveMagicLink("b.two", b), { subjectId: "s1" });
  });
});
