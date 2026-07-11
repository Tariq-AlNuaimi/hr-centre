import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

// rag.ts (ADR-043) is a thin pgvector RAG seam: embed via the pluggable provider,
// store/query through parameterized $queryRaw/$executeRaw. There is no pgvector
// DB or embeddings egress here, so both lib/prisma and lib/ai/embeddings are
// stubbed via node:test module mocks (--experimental-test-module-mocks, which the
// `test` + coverage scripts pass). The mocks let us assert the SQL bind values
// (vector literal, metadata JSON, clamped LIMIT) + the unconfigured worst path
// without any network or Postgres.

const mockApi = mock as unknown as {
  module?: (
    specifier: string,
    options: { namedExports: Record<string, unknown> },
  ) => unknown;
};
const canMock = typeof mockApi.module === "function";

// Minimal stand-in for the real EmbeddingsNotConfiguredError (asserted by name).
class EmbeddingsNotConfiguredError extends Error {
  constructor() {
    super("Embeddings are not configured (test stub)");
    this.name = "EmbeddingsNotConfiguredError";
  }
}

let configured = true;
const execCalls: unknown[][] = [];
const queryCalls: unknown[][] = [];

type Rag = typeof import("../../lib/ai/rag");
let rag: Rag;

before(async () => {
  const RAG_URL = import.meta.resolve("../../lib/ai/rag.ts");
  if (canMock) {
    mockApi.module!(import.meta.resolve("../../lib/prisma.ts"), {
      namedExports: {
        prisma: {
          // Tagged-template call: (strings, ...values). Capture the bound values.
          $executeRaw: async (_s: TemplateStringsArray, ...vals: unknown[]) => {
            execCalls.push(vals);
            return 1;
          },
          $queryRaw: async (_s: TemplateStringsArray, ...vals: unknown[]) => {
            queryCalls.push(vals);
            return [
              { id: "doc-1", namespace: "ns", content: "hello", metadata: null, distance: 0.1 },
            ];
          },
        },
      },
    });
    mockApi.module!(import.meta.resolve("../../lib/ai/embeddings.ts"), {
      namedExports: {
        isEmbeddingsConfigured: () => configured,
        getEmbeddings: () => {
          if (!configured) throw new EmbeddingsNotConfiguredError();
          return { dimensions: 2, embed: async (texts: string[]) => texts.map(() => [0.1, 0.2]) };
        },
        EmbeddingsNotConfiguredError,
      },
    });
  }
  rag = (await import(RAG_URL)) as Rag;
});

test("ragUpsert binds the vector literal + metadata JSON and resolves", async () => {
  if (!canMock) return;
  configured = true;
  execCalls.length = 0;
  await rag.ragUpsert("ns", "doc-1", "hello world", { source: "unit" });
  assert.equal(execCalls.length, 1);
  const vals = execCalls[0];
  // Values order: namespace, id, content, vectorLiteral, metadataJson.
  assert.deepEqual(vals.slice(0, 3), ["ns", "doc-1", "hello world"]);
  assert.equal(vals[3], "[0.1,0.2]");
  assert.equal(vals[4], JSON.stringify({ source: "unit" }));
});

test("ragUpsert stores null metadata when none is provided", async () => {
  if (!canMock) return;
  configured = true;
  execCalls.length = 0;
  await rag.ragUpsert("ns", "doc-2", "text");
  assert.equal(execCalls[0][4], null);
});

test("ragQuery returns rows and clamps k into [1,100]", async () => {
  if (!canMock) return;
  configured = true;
  queryCalls.length = 0;
  const hits = await rag.ragQuery("ns", "query text", 1000);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "doc-1");
  // Values order: vec, namespace, vec, limit. Over-max clamps to 100.
  assert.equal(queryCalls[0][3], 100);
});

test("ragQuery clamps a non-positive / fractional k up to 1", async () => {
  if (!canMock) return;
  configured = true;
  queryCalls.length = 0;
  await rag.ragQuery("ns", "q", 0);
  assert.equal(queryCalls[0][3], 1);
  await rag.ragQuery("ns", "q", -5);
  assert.equal(queryCalls[1][3], 1);
});

test("ragQuery uses the default k=5 when omitted", async () => {
  if (!canMock) return;
  configured = true;
  queryCalls.length = 0;
  await rag.ragQuery("ns", "q");
  assert.equal(queryCalls[0][3], 5);
});

test("ragUpsert throws EmbeddingsNotConfiguredError before any DB write when unconfigured", async () => {
  if (!canMock) return;
  configured = false;
  execCalls.length = 0;
  await assert.rejects(
    () => rag.ragUpsert("ns", "id", "text"),
    (e: Error) => e.name === "EmbeddingsNotConfiguredError",
  );
  assert.equal(execCalls.length, 0, "no DB write on the unconfigured path");
});

test("ragQuery throws EmbeddingsNotConfiguredError before any DB read when unconfigured", async () => {
  if (!canMock) return;
  configured = false;
  queryCalls.length = 0;
  await assert.rejects(
    () => rag.ragQuery("ns", "q"),
    (e: Error) => e.name === "EmbeddingsNotConfiguredError",
  );
  assert.equal(queryCalls.length, 0, "no DB read on the unconfigured path");
});
