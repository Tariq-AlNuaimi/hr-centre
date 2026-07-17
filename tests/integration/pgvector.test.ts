// Integration test — pgvector RAG substrate round-trip (V2-402).
//
// Closes the highest-risk unknowns the WS-5 wave-off named (docs/findings-register.md):
// does the `vector` extension + the `<=>` cosine operator + the HNSW index actually
// resolve on a real Postgres, and does a wrong-dimension INSERT fail LOUD (the 1024-model
// trap, not a silent truncation)? It writes SYNTHETIC vectors directly (no embeddings
// provider / API key needed — the provider round-trip stays separately waived: it needs
// EMBEDDINGS_API_KEY + egress this env lacks), so it verifies the DATABASE half end-to-end.
//
// Needs a live pgvector Postgres. Run via `npm run test:integration` (NOT `npm test` /
// warm `/ship`, which stay DB-free). SKIPS with a clear notice when no such DB is reachable
// (DATABASE_URL unset / placeholder / no `vector` extension) — so it never reds a DB-less
// gate; V2-401's testcontainers path is what makes it run in CI.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

// The dimension is config-driven (EMBEDDINGS_DIMENSIONS, default 1536) and MUST match the
// pgvector column — the exact lockstep the 1024-model trap is about.
// `||` (not `??`) so a set-but-empty EMBEDDINGS_DIMENSIONS falls back to 1536 rather than
// Number("") === 0 (the defensive parse lib/ai/embeddings.ts uses).
const DIM = Number(process.env.EMBEDDINGS_DIMENSIONS || 1536);
const NS = "__v2402_pgvector_test__";
const HNSW_INDEX = "document_embedding_embedding_cosine_idx";

/** Build a DIM-length pgvector literal, zero except the given [index, value] setters. */
function vec(setters: Array<[number, number]>, dim = DIM): string {
  const a = new Array(dim).fill(0);
  for (const [i, v] of setters) a[i] = v;
  return "[" + a.join(",") + "]";
}

let client: pg.Client | null = null;
let reason = "";
// Guard INSIDE each test (not via the `{skip}` option, which node:test evaluates at
// test-DEFINITION time — before `before` runs — so it can't reflect DB reachability
// discovered in the hook). Returns true (and marks the test skipped) when there's no DB.
function skipIfNoDb(t: { skip: (m?: string) => void }): boolean {
  if (reason) {
    t.skip(reason);
    return true;
  }
  return false;
}

before(async () => {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("placeholder")) {
    reason = "no DATABASE_URL (or placeholder) — pgvector integration test skipped";
    return;
  }
  const c = new pg.Client({ connectionString: url });
  try {
    await c.connect();
  } catch (e) {
    reason = `Postgres unreachable (${(e as Error).message}) — pgvector integration test skipped`;
    return;
  }
  const ext = await c.query("SELECT 1 FROM pg_extension WHERE extname='vector'");
  if (!ext.rows.length) {
    reason = "the `vector` extension is not installed on this DB — skipped";
    await c.end();
    return;
  }
  // The table ships in the SAME migration as the extension, but guard anyway: if the
  // extension exists without this app's migration, skip cleanly instead of leaking `c`.
  try {
    await c.query("DELETE FROM document_embedding WHERE namespace=$1", [NS]);
  } catch (e) {
    reason = `document_embedding not present (${(e as Error).message}) — migration unapplied; skipped`;
    await c.end();
    return;
  }
  client = c;
});

after(async () => {
  if (client) {
    try {
      await client.query("DELETE FROM document_embedding WHERE namespace=$1", [NS]);
    } catch {
      /* best-effort cleanup */
    }
    await client.end();
  }
});

test("pgvector: write + `<=>` cosine query returns the nearest doc (round-trip)", async (t) => {
  if (skipIfNoDb(t)) return;
  // Basis-like vectors: 'a' aligned with axis 0, 'b' with axis 1, 'c' mostly axis 0.
  await client!.query(
    `INSERT INTO document_embedding(namespace,id,content,embedding)
       VALUES ($1,'a','doc a',$2),($1,'b','doc b',$3),($1,'c','doc c',$4)`,
    [
      NS,
      vec([[0, 1]]),
      vec([[1, 1]]),
      vec([
        [0, 0.9],
        [1, 0.1],
      ]),
    ],
  );
  const q = vec([[0, 1]]); // aligned with 'a'
  const r = await client!.query(
    `SELECT id, embedding <=> $2 AS dist
       FROM document_embedding WHERE namespace=$1
       ORDER BY embedding <=> $2 LIMIT 3`,
    [NS, q],
  );
  assert.equal(r.rows.length, 3, "all three rows round-trip back");
  assert.equal(r.rows[0].id, "a", "the aligned doc is the cosine-nearest");
  assert.equal(r.rows[2].id, "b", "the orthogonal doc is farthest");
  assert.ok(Number(r.rows[0].dist) < 1e-6, "cosine distance to an identical direction is ~0");
});

test("pgvector: the `<=>` ORDER BY can use the HNSW index (plan check)", async (t) => {
  if (skipIfNoDb(t)) return;
  // With seqscan disabled the planner must reach for the hnsw cosine index to serve the
  // ORDER BY … <=> … LIMIT — proving the index is wired to the operator class.
  await client!.query("BEGIN");
  try {
    await client!.query("SET LOCAL enable_seqscan = off");
    const plan = await client!.query(
      `EXPLAIN (FORMAT TEXT)
         SELECT id FROM document_embedding ORDER BY embedding <=> $1 LIMIT 5`,
      [vec([[0, 1]])],
    );
    const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    assert.match(
      text,
      new RegExp(HNSW_INDEX),
      `expected the HNSW index in the plan; got:\n${text}`,
    );
  } finally {
    await client!.query("ROLLBACK");
  }
});

test("pgvector: a wrong-dimension vector fails LOUD (the 1024-model trap)", async (t) => {
  if (skipIfNoDb(t)) return;
  // A vector whose length != the column's dim must be REJECTED by Postgres, not silently
  // truncated — the exact loud failure the embeddings dimension-lockstep depends on.
  const wrong = vec([[0, 1]], DIM - 512); // e.g. 1024 into a vector(1536) column
  await assert.rejects(
    () =>
      client!.query(
        `INSERT INTO document_embedding(namespace,id,content,embedding) VALUES ($1,'wrongdim','x',$2)`,
        [NS, wrong],
      ),
    /expected \d+ dimensions|different vector dimensions|dimension/i,
    "a dimension mismatch must throw, not silently insert",
  );
});
