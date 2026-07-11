import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aiConfig,
  AiNotConfiguredError,
  getAiClient,
  isAiConfigured,
  runAgent,
  AI_DEFAULT_MAX_TOKENS,
} from "../../lib/ai";

// The Claude-native AI layer (ADR-036, WS-5) is a silent no-op unless AI_API_KEY
// is set (AC-1.2). config reads process.env at CALL time (like the OTel gate), so
// each test mutates + restores the relevant vars. No key is set in the test env,
// so the default state exercises the "AI off" path callers must be safe under.

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
  if (result instanceof Promise) {
    return result.finally(restore);
  }
  restore();
  return result;
}

// --- the gate (isAiConfigured) ---

test("isAiConfigured is false when AI_API_KEY is unset", () => {
  withEnv({ AI_API_KEY: undefined }, () => {
    assert.equal(isAiConfigured(), false);
  });
});

test("isAiConfigured is false for an empty / whitespace key", () => {
  withEnv({ AI_API_KEY: "   " }, () => {
    assert.equal(isAiConfigured(), false);
  });
});

test("isAiConfigured is true when AI_API_KEY is set", () => {
  withEnv({ AI_API_KEY: "sk-test" }, () => {
    assert.equal(isAiConfigured(), true);
  });
});

// --- aiConfig: worst path + defaults + overrides ---

test("aiConfig throws AiNotConfiguredError when unconfigured", () => {
  withEnv({ AI_API_KEY: undefined }, () => {
    assert.throws(() => aiConfig(), AiNotConfiguredError);
  });
});

test("aiConfig applies defaults: hosted endpoint, x-api-key, opus tier", () => {
  withEnv(
    {
      AI_API_KEY: "sk-test",
      AI_BASE_URL: undefined,
      AI_AUTH_STYLE: undefined,
      AI_MODEL: undefined,
    },
    () => {
      const cfg = aiConfig();
      assert.equal(cfg.apiKey, "sk-test");
      assert.equal(cfg.baseUrl, undefined);
      assert.equal(cfg.authStyle, "x-api-key");
      assert.equal(cfg.model, "claude-opus-4-8");
    },
  );
});

test("aiConfig reads AI_BASE_URL / AI_AUTH_STYLE / AI_MODEL when set", () => {
  withEnv(
    {
      AI_API_KEY: "sk-test",
      AI_BASE_URL: "https://gateway.internal/anthropic",
      AI_AUTH_STYLE: "bearer",
      AI_MODEL: "claude-haiku-4-5",
    },
    () => {
      const cfg = aiConfig();
      assert.equal(cfg.baseUrl, "https://gateway.internal/anthropic");
      assert.equal(cfg.authStyle, "bearer");
      assert.equal(cfg.model, "claude-haiku-4-5");
    },
  );
});

test("aiConfig treats a blank AI_BASE_URL as unset (hosted default)", () => {
  withEnv({ AI_API_KEY: "sk-test", AI_BASE_URL: "   " }, () => {
    assert.equal(aiConfig().baseUrl, undefined);
  });
});

test("aiConfig falls back to x-api-key for an unrecognized auth style", () => {
  withEnv({ AI_API_KEY: "sk-test", AI_AUTH_STYLE: "basic" }, () => {
    assert.equal(aiConfig().authStyle, "x-api-key");
  });
});

// --- getAiClient: worst path + endpoint-agnostic wiring (AC-1.1 / 1.2 / 3.1) ---

test("getAiClient throws AiNotConfiguredError when unconfigured", () => {
  withEnv({ AI_API_KEY: undefined }, () => {
    assert.throws(() => getAiClient(), AiNotConfiguredError);
  });
});

test("getAiClient wires x-api-key onto apiKey (default)", () => {
  withEnv({ AI_API_KEY: "sk-test", AI_AUTH_STYLE: undefined, AI_BASE_URL: undefined }, () => {
    const client = getAiClient();
    assert.equal(client.apiKey, "sk-test");
    assert.equal(client.authToken, null);
  });
});

test("getAiClient wires bearer onto authToken (not apiKey)", () => {
  withEnv({ AI_API_KEY: "tok-test", AI_AUTH_STYLE: "bearer" }, () => {
    const client = getAiClient();
    assert.equal(client.authToken, "tok-test");
    assert.equal(client.apiKey, null);
  });
});

test("getAiClient ignores ambient ANTHROPIC_API_KEY in bearer mode (no dual-auth)", () => {
  withEnv(
    {
      AI_API_KEY: "tok-test",
      AI_AUTH_STYLE: "bearer",
      ANTHROPIC_API_KEY: "sk-ambient",
    },
    () => {
      const client = getAiClient();
      assert.equal(client.authToken, "tok-test");
      // Would be "sk-ambient" if the SDK's env fallback leaked through — the
      // explicit null pin prevents the dual-auth 401.
      assert.equal(client.apiKey, null);
    },
  );
});

test("getAiClient ignores ambient ANTHROPIC_AUTH_TOKEN in x-api-key mode", () => {
  withEnv(
    {
      AI_API_KEY: "sk-test",
      AI_AUTH_STYLE: "x-api-key",
      ANTHROPIC_AUTH_TOKEN: "tok-ambient",
    },
    () => {
      const client = getAiClient();
      assert.equal(client.apiKey, "sk-test");
      assert.equal(client.authToken, null);
    },
  );
});

test("getAiClient targets AI_BASE_URL when set", () => {
  withEnv({ AI_API_KEY: "sk-test", AI_BASE_URL: "https://gateway.internal/anthropic" }, () => {
    assert.equal(getAiClient().baseURL, "https://gateway.internal/anthropic");
  });
});

// --- runAgent: pre-network guard + native runner pass-through (AC-2.1 / 2.2) ---

test("runAgent throws AiNotConfiguredError before any network attempt", () => {
  withEnv({ AI_API_KEY: undefined }, () => {
    assert.throws(
      () => runAgent({ messages: [{ role: "user", content: "hi" }], tools: [] }),
      AiNotConfiguredError,
    );
  });
});

test("runAgent returns the native Tool Runner (awaitable + iterable)", () => {
  withEnv({ AI_API_KEY: "sk-test" }, () => {
    // Constructing the runner does not hit the network (only awaiting/iterating
    // does), so this exercises the pass-through without a live endpoint.
    const runner = runAgent({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    assert.equal(typeof runner.then, "function");
    assert.equal(typeof runner[Symbol.asyncIterator], "function");
  });
});

test("AI_DEFAULT_MAX_TOKENS is a positive per-turn output cap", () => {
  assert.equal(Number.isInteger(AI_DEFAULT_MAX_TOKENS), true);
  assert.ok(AI_DEFAULT_MAX_TOKENS > 0);
});
