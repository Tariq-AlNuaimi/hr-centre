import { test } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withAiRoute } from "../../lib/ai";

// withAiRoute (ADR-036 follow-on) factors the guard/parse/trace preamble every
// scaffolded AI route repeats: isAiConfigured() -> 503, zod body parse -> 400,
// then run() inside withSpan(). Auth + rate-limit stay at the call site (not
// exercised here). AI_API_KEY is mutated + restored per test; withSpan is the
// no-op tracer (no OTLP endpoint), so no network/infra is touched.

function withEnv(
  key: string,
  value: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return (async () => {
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  })();
}

const schema = z.object({ prompt: z.string().min(1, "prompt is required") });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(json: () => Promise<unknown>): any {
  return { json };
}

test("withAiRoute returns 503 when the AI layer is unconfigured", async () => {
  await withEnv("AI_API_KEY", undefined, async () => {
    const handler = withAiRoute({ span: "ai.test", schema }, async () =>
      NextResponse.json({ data: { text: "x" } }),
    );
    const res = await handler(req(async () => ({ prompt: "hi" })));
    assert.equal(res.status, 503);
  });
});

test("withAiRoute returns 400 when the body fails validation", async () => {
  await withEnv("AI_API_KEY", "sk-test", async () => {
    let ran = false;
    const handler = withAiRoute({ span: "ai.test", schema }, async () => {
      ran = true;
      return NextResponse.json({ data: { text: "x" } });
    });
    const res = await handler(req(async () => ({ prompt: "" })));
    assert.equal(res.status, 400);
    assert.equal(ran, false, "run() must not execute on a validation failure");
    const body = await res.json();
    assert.match(body.error, /prompt is required/);
  });
});

test("withAiRoute returns 400 when the request body is not valid JSON", async () => {
  await withEnv("AI_API_KEY", "sk-test", async () => {
    const handler = withAiRoute({ span: "ai.test", schema }, async () =>
      NextResponse.json({ data: { text: "x" } }),
    );
    const res = await handler(
      req(async () => {
        throw new SyntaxError("Unexpected token");
      }),
    );
    assert.equal(res.status, 400);
  });
});

test("withAiRoute runs the handler (inside withSpan) on a valid body", async () => {
  await withEnv("AI_API_KEY", "sk-test", async () => {
    const handler = withAiRoute({ span: "ai.test", schema }, async (input, request) => {
      assert.equal(input.prompt, "summarize this");
      assert.ok(request, "run() receives the request");
      return NextResponse.json({ data: { text: `echo:${input.prompt}` } }, { status: 200 });
    });
    const res = await handler(req(async () => ({ prompt: "summarize this" })));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.text, "echo:summarize this");
  });
});
