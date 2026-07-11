import { test } from "node:test";
import assert from "node:assert/strict";

import {
  withAiSpan,
  aiTraceContentEnabled,
  recordAiContent,
  setAiRequestAttributes,
  setAiResponseAttributes,
  GEN_AI_ATTR,
  GEN_AI_SYSTEM_ANTHROPIC,
} from "../../lib/ai";

// GenAI-semconv tracing (ADR-044) is built on the OTel backbone, which is a
// no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set. These tests exercise the
// attribute-decoration + content-gate logic directly against a capturing fake
// span, plus the withAiSpan wrapper against the real (no-op) tracer, so no OTLP
// sink is required. AI_TRACE_CONTENT is mutated + restored per test.

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

// A minimal capturing Span: only setAttribute is exercised by the tracer helpers.
function fakeSpan() {
  const attrs: Record<string, unknown> = {};
  return {
    attrs,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setAttribute(k: string, v: any) {
      attrs[k] = v;
      return this;
    },
  };
}

// --- aiTraceContentEnabled: the Restricted-content gate (default OFF) ---

test("aiTraceContentEnabled is false when AI_TRACE_CONTENT is unset", () => {
  withEnv("AI_TRACE_CONTENT", undefined, () => {
    assert.equal(aiTraceContentEnabled(), false);
  });
});

for (const v of ["1", "true", "yes", "on", "TRUE", "On"]) {
  test(`aiTraceContentEnabled is true for "${v}"`, () => {
    withEnv("AI_TRACE_CONTENT", v, () => {
      assert.equal(aiTraceContentEnabled(), true);
    });
  });
}

for (const v of ["0", "false", "", "  ", "nope"]) {
  test(`aiTraceContentEnabled is false for "${v}"`, () => {
    withEnv("AI_TRACE_CONTENT", v, () => {
      assert.equal(aiTraceContentEnabled(), false);
    });
  });
}

// --- setAiRequestAttributes: request-side gen_ai.* ---

test("setAiRequestAttributes applies defaults (system=anthropic, operation=chat)", () => {
  const span = fakeSpan();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAiRequestAttributes(span as any, {});
  assert.equal(span.attrs[GEN_AI_ATTR.system], GEN_AI_SYSTEM_ANTHROPIC);
  assert.equal(span.attrs[GEN_AI_ATTR.operationName], "chat");
  assert.equal(span.attrs[GEN_AI_ATTR.requestModel], undefined);
  assert.equal(span.attrs[GEN_AI_ATTR.requestMaxTokens], undefined);
});

test("setAiRequestAttributes sets model, maxTokens, custom fields + extra attributes", () => {
  const span = fakeSpan();
  setAiRequestAttributes(span as any, {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    model: "claude-opus-4-8",
    operation: "tool_use",
    system: "gateway",
    maxTokens: 1024,
    attributes: { "app.endpoint": "summarize", "app.n": 3 },
  });
  assert.equal(span.attrs[GEN_AI_ATTR.requestModel], "claude-opus-4-8");
  assert.equal(span.attrs[GEN_AI_ATTR.operationName], "tool_use");
  assert.equal(span.attrs[GEN_AI_ATTR.system], "gateway");
  assert.equal(span.attrs[GEN_AI_ATTR.requestMaxTokens], 1024);
  assert.equal(span.attrs["app.endpoint"], "summarize");
  assert.equal(span.attrs["app.n"], 3);
});

// --- setAiResponseAttributes: response-side gen_ai.* (tolerant of partials) ---

test("setAiResponseAttributes ignores non-object / null results", () => {
  const span = fakeSpan();
  setAiResponseAttributes(span as any, null); // eslint-disable-line @typescript-eslint/no-explicit-any
  setAiResponseAttributes(span as any, "str"); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(span.attrs, {});
});

test("setAiResponseAttributes reads model, finish reason, and token usage", () => {
  const span = fakeSpan();
  setAiResponseAttributes(span as any, {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    model: "claude-opus-4-8",
    stop_reason: "end_turn",
    usage: { input_tokens: 12, output_tokens: 34 },
  });
  assert.equal(span.attrs[GEN_AI_ATTR.responseModel], "claude-opus-4-8");
  assert.deepEqual(span.attrs[GEN_AI_ATTR.responseFinishReasons], ["end_turn"]);
  assert.equal(span.attrs[GEN_AI_ATTR.usageInputTokens], 12);
  assert.equal(span.attrs[GEN_AI_ATTR.usageOutputTokens], 34);
});

test("setAiResponseAttributes tolerates absent usage / empty fields", () => {
  const span = fakeSpan();
  setAiResponseAttributes(span as any, { model: "", stop_reason: "", usage: null }); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(span.attrs, {});
});

// --- recordAiContent: opt-in, Restricted content ---

test("recordAiContent is a no-op when AI_TRACE_CONTENT is off", () => {
  withEnv("AI_TRACE_CONTENT", undefined, () => {
    const span = fakeSpan();
    recordAiContent(span as any, { prompt: "p", completion: "c" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(span.attrs, {});
  });
});

test("recordAiContent sets content attributes when enabled", () => {
  withEnv("AI_TRACE_CONTENT", "1", () => {
    const span = fakeSpan();
    recordAiContent(span as any, { prompt: "hello", completion: "world" }); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(span.attrs["gen_ai.prompt"], "hello");
    assert.equal(span.attrs["gen_ai.completion"], "world");
  });
});

// --- withAiSpan: wraps withSpan, sets req + resp attributes, returns result ---

test("withAiSpan returns the callback result (OTel off => no-op tracer)", async () => {
  const result = await withAiSpan("ai.test", { model: "m" }, () => ({
    model: "m",
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 2 },
  }));
  assert.equal(result.model, "m");
});

test("withAiSpan passes a span to the callback", async () => {
  await withAiSpan("ai.span-arg", {}, (span) => {
    assert.ok(span);
    assert.equal(typeof span.setAttribute, "function");
    return null;
  });
});

test("withAiSpan re-throws the callback error unchanged", async () => {
  const boom = new Error("boom");
  await assert.rejects(
    () =>
      withAiSpan("ai.throws", {}, () => {
        throw boom;
      }),
    (e) => e === boom,
  );
});
