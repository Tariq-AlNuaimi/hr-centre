import { test } from "node:test";
import assert from "node:assert/strict";
import { draftRoleProfile, isLlmConfigured, LlmError } from "../../lib/llm";

// Verifies the Next->LLM seam WITHOUT a live endpoint: global fetch is stubbed.
// Covers config gating, the Bearer header, JSON/schema validation of the model
// output, and that an off-contract or unreachable model surfaces as LlmError (so
// the route falls back to manual authoring) -- never a thrown 500.

const realFetch = globalThis.fetch;

function snapshot() {
  return {
    url: process.env.LLM_ENDPOINT_URL,
    token: process.env.LLM_ENDPOINT_TOKEN,
  };
}
function restore(s: { url?: string; token?: string }) {
  s.url === undefined ? delete process.env.LLM_ENDPOINT_URL : (process.env.LLM_ENDPOINT_URL = s.url);
  s.token === undefined ? delete process.env.LLM_ENDPOINT_TOKEN : (process.env.LLM_ENDPOINT_TOKEN = s.token);
  globalThis.fetch = realFetch;
}

const validInput = {
  roleFamilyKey: "sales",
  roleTitle: "Sales Executive",
  jdSourceText:
    "Drive new business, hit quarterly targets, build long-term client relationships, and stay resilient under pressure.",
};

function chatResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const validDraftJson = JSON.stringify({
  competencies: [
    { name: "Achievement / Drive", weight: 1.2, direction: "HIGH", targetPercentile: 70, facets: ["achievement_striving"] },
  ],
});

test("isLlmConfigured reflects LLM_ENDPOINT_URL presence", () => {
  const s = snapshot();
  try {
    delete process.env.LLM_ENDPOINT_URL;
    assert.equal(isLlmConfigured(), false);
    process.env.LLM_ENDPOINT_URL = "https://llm.example/v1";
    assert.equal(isLlmConfigured(), true);
  } finally {
    restore(s);
  }
});

test("unconfigured endpoint throws LlmError (no fetch)", async () => {
  const s = snapshot();
  try {
    delete process.env.LLM_ENDPOINT_URL;
    await assert.rejects(() => draftRoleProfile(validInput), LlmError);
  } finally {
    restore(s);
  }
});

test("sends Bearer token and parses a valid draft", async () => {
  const s = snapshot();
  try {
    process.env.LLM_ENDPOINT_URL = "https://llm.example/v1";
    process.env.LLM_ENDPOINT_TOKEN = "x".repeat(32);
    let sawAuth: string | null = null;
    let sawUrl = "";
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sawUrl = String(url);
      sawAuth = new Headers(init.headers).get("authorization");
      return chatResponse(validDraftJson);
    }) as typeof fetch;

    const draft = await draftRoleProfile(validInput);
    assert.equal(sawUrl, "https://llm.example/v1/chat/completions");
    assert.equal(sawAuth, `Bearer ${"x".repeat(32)}`);
    assert.equal(draft.competencies.length, 1);
    assert.equal(draft.competencies[0].facets[0], "achievement_striving");
  } finally {
    restore(s);
  }
});

test("tolerates a ```json fenced completion", async () => {
  const s = snapshot();
  try {
    process.env.LLM_ENDPOINT_URL = "https://llm.example/v1";
    globalThis.fetch = (async () =>
      chatResponse("```json\n" + validDraftJson + "\n```")) as typeof fetch;
    const draft = await draftRoleProfile(validInput);
    assert.equal(draft.competencies.length, 1);
  } finally {
    restore(s);
  }
});

test("an off-contract model response (bad facet) becomes LlmError", async () => {
  const s = snapshot();
  try {
    process.env.LLM_ENDPOINT_URL = "https://llm.example/v1";
    const bad = JSON.stringify({
      competencies: [{ name: "X", weight: 1, direction: "HIGH", targetPercentile: 70, facets: ["telepathy"] }],
    });
    globalThis.fetch = (async () => chatResponse(bad)) as typeof fetch;
    await assert.rejects(() => draftRoleProfile(validInput), LlmError);
  } finally {
    restore(s);
  }
});

test("non-2xx and non-JSON content both surface as LlmError", async () => {
  const s = snapshot();
  try {
    process.env.LLM_ENDPOINT_URL = "https://llm.example/v1";
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    await assert.rejects(() => draftRoleProfile(validInput), LlmError);

    globalThis.fetch = (async () => chatResponse("not json at all")) as typeof fetch;
    await assert.rejects(() => draftRoleProfile(validInput), LlmError);
  } finally {
    restore(s);
  }
});
