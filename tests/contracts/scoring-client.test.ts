import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requestScoring,
  isScoringConfigured,
  ScoringError,
} from "../../lib/scoring";
import type { ScoreResponse } from "../../lib/validations/scoring";

// Verifies the Next->scoring-service seam WITHOUT a live service: global fetch is
// stubbed. Covers configuration gating, the Bearer header, request validation,
// non-2xx handling, and response-contract validation at the trust boundary.

const realFetch = globalThis.fetch;

function envSnapshot() {
  return {
    url: process.env.SCORING_SERVICE_URL,
    token: process.env.SCORING_SERVICE_TOKEN,
  };
}
function envRestore(s: { url?: string; token?: string }) {
  s.url === undefined ? delete process.env.SCORING_SERVICE_URL : (process.env.SCORING_SERVICE_URL = s.url);
  s.token === undefined ? delete process.env.SCORING_SERVICE_TOKEN : (process.env.SCORING_SERVICE_TOKEN = s.token);
  globalThis.fetch = realFetch;
}

function validAnswers() {
  return Array.from({ length: 120 }, (_, k) => ({ itemNumber: k + 1, response: 3 }));
}

function fakeResponse(): ScoreResponse {
  const facets = Array.from({ length: 6 }, (_, k) => ({
    facet: `f${k + 1}`,
    facetNumber: k + 1,
    raw: 12,
    percentile: 50,
    score: "average" as const,
  }));
  return {
    model: "IPIP-NEO-120",
    deterministic: true,
    norms: { source: "Johnson IPIP-NEO (osf.io/jxpu4)", via: "five-factor-e", sex: "N", age: 30 },
    domains: (["OPENNESS", "CONSCIENTIOUSNESS", "EXTRAVERSION", "AGREEABLENESS", "NEUROTICISM"] as const).map(
      (domain) => ({ domain, raw: 72, percentile: 50, score: "average" as const, facets })
    ),
  };
}

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init ?? {})) as typeof fetch;
}

test("isScoringConfigured reflects SCORING_SERVICE_URL", () => {
  const s = envSnapshot();
  try {
    delete process.env.SCORING_SERVICE_URL;
    assert.equal(isScoringConfigured(), false);
    process.env.SCORING_SERVICE_URL = "http://localhost:8000";
    assert.equal(isScoringConfigured(), true);
  } finally {
    envRestore(s);
  }
});

test("throws ScoringError when URL is not configured", async () => {
  const s = envSnapshot();
  try {
    delete process.env.SCORING_SERVICE_URL;
    await assert.rejects(
      () => requestScoring({ answers: validAnswers() }),
      (e: unknown) => e instanceof ScoringError && /not configured/.test((e as Error).message)
    );
  } finally {
    envRestore(s);
  }
});

test("posts to /score, sends Bearer token, returns validated payload", async () => {
  const s = envSnapshot();
  try {
    process.env.SCORING_SERVICE_URL = "http://scorer:8000/"; // trailing slash trimmed
    process.env.SCORING_SERVICE_TOKEN = "tok-123";
    let seenUrl = "";
    let seenAuth: string | undefined;
    let seenBody: { sex?: string; age?: number } = {};
    stubFetch((url, init) => {
      seenUrl = url;
      seenAuth = new Headers(init.headers).get("authorization") ?? undefined;
      seenBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify(fakeResponse()), { status: 200 });
    });
    const res = await requestScoring({ answers: validAnswers() });
    assert.equal(seenUrl, "http://scorer:8000/score");
    assert.equal(seenAuth, "Bearer tok-123");
    assert.equal(seenBody.sex, "N"); // default applied before sending
    assert.equal(seenBody.age, 30);
    assert.equal(res.domains.length, 5);
    assert.equal(res.model, "IPIP-NEO-120");
  } finally {
    envRestore(s);
  }
});

test("omits Authorization header when no token is set", async () => {
  const s = envSnapshot();
  try {
    process.env.SCORING_SERVICE_URL = "http://scorer:8000";
    delete process.env.SCORING_SERVICE_TOKEN;
    let seenAuth: string | null = "unset";
    stubFetch((_url, init) => {
      seenAuth = new Headers(init.headers).get("authorization");
      return new Response(JSON.stringify(fakeResponse()), { status: 200 });
    });
    await requestScoring({ answers: validAnswers() });
    assert.equal(seenAuth, null);
  } finally {
    envRestore(s);
  }
});

test("rejects an invalid request before sending (no fetch)", async () => {
  const s = envSnapshot();
  try {
    process.env.SCORING_SERVICE_URL = "http://scorer:8000";
    let called = false;
    stubFetch(() => {
      called = true;
      return new Response("{}", { status: 200 });
    });
    await assert.rejects(() => requestScoring({ answers: validAnswers().slice(0, 119) }));
    assert.equal(called, false, "should not call the service with a bad request");
  } finally {
    envRestore(s);
  }
});

test("surfaces a non-2xx service error", async () => {
  const s = envSnapshot();
  try {
    process.env.SCORING_SERVICE_URL = "http://scorer:8000";
    stubFetch(() => new Response(JSON.stringify({ error: "boom" }), { status: 422 }));
    await assert.rejects(
      () => requestScoring({ answers: validAnswers() }),
      (e: unknown) => e instanceof ScoringError && (e as ScoringError).status === 422 && /boom/.test((e as Error).message)
    );
  } finally {
    envRestore(s);
  }
});

test("rejects a malformed response payload", async () => {
  const s = envSnapshot();
  try {
    process.env.SCORING_SERVICE_URL = "http://scorer:8000";
    stubFetch(() => new Response(JSON.stringify({ model: "IPIP-NEO-120", domains: [] }), { status: 200 }));
    await assert.rejects(
      () => requestScoring({ answers: validAnswers() }),
      (e: unknown) => e instanceof ScoringError && /unexpected payload/.test((e as Error).message)
    );
  } finally {
    envRestore(s);
  }
});
