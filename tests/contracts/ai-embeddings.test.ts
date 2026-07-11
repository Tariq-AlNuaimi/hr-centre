import { test } from "node:test";
import assert from "node:assert/strict";

import { getEmbeddings, isEmbeddingsConfigured, EmbeddingsNotConfiguredError } from "../../lib/ai";

// The embeddings seam (ADR-043) mirrors the AI_* gate: a silent no-op until
// EMBEDDINGS_PROVIDER + EMBEDDINGS_API_KEY are set. Config reads process.env at
// CALL time, so each test mutates + restores. Provider round-trips are exercised
// against a stubbed global.fetch (no network) to confirm the documented wire
// shapes + row-order handling without any embeddings egress.

function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): void | Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  let result: void | Promise<void>;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result instanceof Promise) return result.finally(restore);
  restore();
  return result;
}

async function withFetch(
  impl: (url: string, init: RequestInit) => Promise<Response> | Response,
  fn: () => Promise<void>,
): Promise<void> {
  const orig = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = ((url: any, init: any) => impl(String(url), init)) as any;
  try {
    await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

// --- the gate (isEmbeddingsConfigured) ---

test("isEmbeddingsConfigured is false when no provider is set", () => {
  withEnv({ EMBEDDINGS_PROVIDER: undefined, EMBEDDINGS_API_KEY: "k" }, () => {
    assert.equal(isEmbeddingsConfigured(), false);
  });
});

test("isEmbeddingsConfigured is false for provider 'none'", () => {
  withEnv({ EMBEDDINGS_PROVIDER: "none", EMBEDDINGS_API_KEY: "k" }, () => {
    assert.equal(isEmbeddingsConfigured(), false);
  });
});

test("isEmbeddingsConfigured is false when the key is missing/blank", () => {
  withEnv({ EMBEDDINGS_PROVIDER: "voyage", EMBEDDINGS_API_KEY: "  " }, () => {
    assert.equal(isEmbeddingsConfigured(), false);
  });
});

test("isEmbeddingsConfigured is true for a provider + key (case-insensitive)", () => {
  withEnv({ EMBEDDINGS_PROVIDER: "VOYAGE", EMBEDDINGS_API_KEY: "k" }, () => {
    assert.equal(isEmbeddingsConfigured(), true);
  });
});

// --- getEmbeddings: worst path + config defaults ---

test("getEmbeddings throws EmbeddingsNotConfiguredError when unconfigured", () => {
  withEnv({ EMBEDDINGS_PROVIDER: undefined, EMBEDDINGS_API_KEY: undefined }, () => {
    assert.throws(() => getEmbeddings(), EmbeddingsNotConfiguredError);
  });
});

test("getEmbeddings defaults the dimension to 1536", () => {
  withEnv(
    { EMBEDDINGS_PROVIDER: "voyage", EMBEDDINGS_API_KEY: "k", EMBEDDINGS_DIMENSIONS: undefined },
    () => {
      assert.equal(getEmbeddings().dimensions, 1536);
    },
  );
});

test("getEmbeddings reads EMBEDDINGS_DIMENSIONS when set", () => {
  withEnv(
    { EMBEDDINGS_PROVIDER: "cohere", EMBEDDINGS_API_KEY: "k", EMBEDDINGS_DIMENSIONS: "1024" },
    () => {
      assert.equal(getEmbeddings().dimensions, 1024);
    },
  );
});

test("getEmbeddings falls back to 1536 for a non-positive dimension", () => {
  withEnv(
    { EMBEDDINGS_PROVIDER: "voyage", EMBEDDINGS_API_KEY: "k", EMBEDDINGS_DIMENSIONS: "0" },
    () => {
      assert.equal(getEmbeddings().dimensions, 1536);
    },
  );
});

// --- voyage provider round-trip (stubbed fetch) ---

test("voyage embed() returns [] for empty input without calling fetch", async () => {
  await withEnv({ EMBEDDINGS_PROVIDER: "voyage", EMBEDDINGS_API_KEY: "k" }, async () => {
    await withFetch(
      () => {
        throw new Error("fetch should not be called for empty input");
      },
      async () => {
        const out = await getEmbeddings().embed([]);
        assert.deepEqual(out, []);
      },
    );
  });
});

test("voyage embed() orders rows by returned index", async () => {
  await withEnv(
    { EMBEDDINGS_PROVIDER: "voyage", EMBEDDINGS_API_KEY: "k", EMBEDDINGS_BASE_URL: undefined },
    async () => {
      await withFetch(
        (url, init) => {
          assert.match(url, /voyageai\.com/);
          assert.equal((init.headers as Record<string, string>).authorization, "Bearer k");
          return new Response(
            JSON.stringify({
              data: [
                { embedding: [0.2], index: 1 },
                { embedding: [0.1], index: 0 },
              ],
            }),
            { status: 200 },
          );
        },
        async () => {
          const out = await getEmbeddings().embed(["a", "b"]);
          assert.deepEqual(out, [[0.1], [0.2]]);
        },
      );
    },
  );
});

test("voyage embed() throws on a non-ok response", async () => {
  await withEnv({ EMBEDDINGS_PROVIDER: "voyage", EMBEDDINGS_API_KEY: "k" }, async () => {
    await withFetch(
      () => new Response("nope", { status: 500 }),
      async () => {
        await assert.rejects(() => getEmbeddings().embed(["a"]), /voyage request failed \(500\)/);
      },
    );
  });
});

// --- cohere provider round-trip (stubbed fetch) ---

test("cohere embed() returns the embeddings array from the response", async () => {
  await withEnv(
    {
      EMBEDDINGS_PROVIDER: "cohere",
      EMBEDDINGS_API_KEY: "k",
      EMBEDDINGS_MODEL: "embed-english-v3.0",
    },
    async () => {
      await withFetch(
        (url, init) => {
          assert.match(url, /cohere\.ai/);
          const parsed = JSON.parse(String(init.body));
          assert.equal(parsed.input_type, "search_document");
          return new Response(JSON.stringify({ embeddings: [[1, 2, 3]] }), { status: 200 });
        },
        async () => {
          const out = await getEmbeddings().embed(["hi"]);
          assert.deepEqual(out, [[1, 2, 3]]);
        },
      );
    },
  );
});

test("cohere embed() throws on a non-ok response", async () => {
  await withEnv({ EMBEDDINGS_PROVIDER: "cohere", EMBEDDINGS_API_KEY: "k" }, async () => {
    await withFetch(
      () => new Response("bad", { status: 429 }),
      async () => {
        await assert.rejects(() => getEmbeddings().embed(["a"]), /cohere request failed \(429\)/);
      },
    );
  });
});
