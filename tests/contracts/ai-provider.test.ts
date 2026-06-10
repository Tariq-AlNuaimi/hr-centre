import { test } from "node:test";
import assert from "node:assert/strict";
import { updateAiProviderSchema } from "../../lib/validations/ai-provider";

// Vibe Inspector (ADR-016) — AI provider settings validation. Pure: no DB/network.

test("ANTHROPIC config is valid without a base URL", () => {
  const r = updateAiProviderSchema.safeParse({
    provider: "ANTHROPIC",
    model: "claude-opus-4-8",
  });
  assert.equal(r.success, true);
});

test("OPENAI_COMPATIBLE requires a base URL", () => {
  const r = updateAiProviderSchema.safeParse({
    provider: "OPENAI_COMPATIBLE",
    model: "gpt-oss-120b",
  });
  assert.equal(r.success, false);
});

test("OPENAI_COMPATIBLE accepts a valid base URL", () => {
  const r = updateAiProviderSchema.safeParse({
    provider: "OPENAI_COMPATIBLE",
    baseUrl: "https://litellm.rihal.dev/",
    model: "rihal/openai/gpt-oss-120b",
    apiKey: "sk-test",
  });
  assert.equal(r.success, true);
});

test("OPENAI_COMPATIBLE rejects a non-URL base URL", () => {
  const r = updateAiProviderSchema.safeParse({
    provider: "OPENAI_COMPATIBLE",
    baseUrl: "not a url",
    model: "x",
  });
  assert.equal(r.success, false);
});

test("model is required", () => {
  const r = updateAiProviderSchema.safeParse({ provider: "ANTHROPIC", model: "" });
  assert.equal(r.success, false);
});

test("apiKey is optional (blank keeps existing)", () => {
  const r = updateAiProviderSchema.safeParse({
    provider: "ANTHROPIC",
    model: "claude-opus-4-8",
    apiKey: "",
  });
  assert.equal(r.success, true);
});
