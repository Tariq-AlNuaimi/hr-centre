import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isOtelEnabled,
  otelServiceName,
  withSpan,
} from "../../lib/observability";

// The OTel backbone (ADR-040) is a no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is
// set (AC-5.1). config helpers read process.env at CALL time, so each test
// mutates + restores the relevant vars. No OTLP endpoint is set in the test
// env, so `withSpan` exercises the @opentelemetry/api no-op tracer path — which
// is exactly the "observability off" runtime shape callers must be safe under.

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

test("isOtelEnabled is false when OTEL_EXPORTER_OTLP_ENDPOINT is unset", () => {
  withEnv("OTEL_EXPORTER_OTLP_ENDPOINT", undefined, () => {
    assert.equal(isOtelEnabled(), false);
  });
});

test("isOtelEnabled is false for an empty / whitespace endpoint", () => {
  withEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "   ", () => {
    assert.equal(isOtelEnabled(), false);
  });
});

test("isOtelEnabled is true when a real endpoint is configured", () => {
  withEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318", () => {
    assert.equal(isOtelEnabled(), true);
  });
});

test("otelServiceName defaults to 'app' when unset", () => {
  withEnv("OTEL_SERVICE_NAME", undefined, () => {
    assert.equal(otelServiceName(), "app");
  });
});

test("otelServiceName trims and uses OTEL_SERVICE_NAME when set", () => {
  withEnv("OTEL_SERVICE_NAME", "  billing-svc  ", () => {
    assert.equal(otelServiceName(), "billing-svc");
  });
});

test("otelServiceName falls back to the default for a blank value", () => {
  withEnv("OTEL_SERVICE_NAME", "   ", () => {
    assert.equal(otelServiceName(), "app");
  });
});

test("withSpan returns the callback result (OTel off => no-op tracer)", async () => {
  const result = await withSpan("test.op", () => 42);
  assert.equal(result, 42);
});

test("withSpan awaits an async callback", async () => {
  const result = await withSpan("test.async", async () => {
    await Promise.resolve();
    return "done";
  });
  assert.equal(result, "done");
});

test("withSpan re-throws the callback's error unchanged (never swallows)", async () => {
  const boom = new Error("boom");
  await assert.rejects(
    () =>
      withSpan("test.throws", () => {
        throw boom;
      }),
    (err) => err === boom,
  );
});

test("withSpan passes a span to the callback", async () => {
  await withSpan("test.span-arg", (span) => {
    assert.ok(span, "callback should receive a span object");
    assert.equal(typeof span.end, "function");
    assert.equal(typeof span.setStatus, "function");
  });
});
