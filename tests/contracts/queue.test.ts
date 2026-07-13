import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getQueue,
  isQueueConfigured,
  queueConfig,
  QueueNotConfiguredError,
  registerWorker,
  sendJob,
  stopQueue,
} from "../../lib/queue";

// The background-job seam (lib/queue/*) is a silent no-op unless the operator
// EXPLICITLY opts in with QUEUE_ENABLED="true" (a DB URL alone must never start
// pg-boss polling the app database). config reads process.env at CALL time
// (like the AI/OTel gates), so each test mutates + restores the relevant vars.
// No test constructs or start()s a real pg-boss instance: the unconfigured
// paths throw BEFORE construction, and the configured paths only exercise
// queueConfig() parsing — never getQueue() — so no DB connection is opened.

const TEST_URL = "postgresql://app:app_secret@localhost:5432/app_db?schema=public";
const QUEUE_URL = "postgresql://jobs:jobs_secret@localhost:5432/jobs_db";

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

// --- the gate (isQueueConfigured): explicit opt-in, never URL-presence alone ---

test("isQueueConfigured is false when QUEUE_ENABLED is unset, even with DATABASE_URL set", () => {
  withEnv(
    { QUEUE_ENABLED: undefined, QUEUE_DATABASE_URL: undefined, DATABASE_URL: TEST_URL },
    () => {
      assert.equal(isQueueConfigured(), false);
    },
  );
});

test('isQueueConfigured requires exactly "true" — "1"/"TRUE"/"yes" do not enable it', () => {
  for (const value of ["1", "TRUE", "yes", "on", ""]) {
    withEnv({ QUEUE_ENABLED: value, DATABASE_URL: TEST_URL, QUEUE_DATABASE_URL: undefined }, () => {
      assert.equal(isQueueConfigured(), false);
    });
  }
});

test("isQueueConfigured is false when enabled but no database URL exists", () => {
  withEnv({ QUEUE_ENABLED: "true", QUEUE_DATABASE_URL: undefined, DATABASE_URL: undefined }, () => {
    assert.equal(isQueueConfigured(), false);
  });
});

test("isQueueConfigured treats whitespace-only URLs as unset", () => {
  withEnv({ QUEUE_ENABLED: "true", QUEUE_DATABASE_URL: "   ", DATABASE_URL: "  " }, () => {
    assert.equal(isQueueConfigured(), false);
  });
});

test("isQueueConfigured is true when enabled with DATABASE_URL (fallback)", () => {
  withEnv({ QUEUE_ENABLED: "true", QUEUE_DATABASE_URL: undefined, DATABASE_URL: TEST_URL }, () => {
    assert.equal(isQueueConfigured(), true);
  });
});

test("isQueueConfigured is true when enabled with only QUEUE_DATABASE_URL", () => {
  withEnv({ QUEUE_ENABLED: "true", QUEUE_DATABASE_URL: QUEUE_URL, DATABASE_URL: undefined }, () => {
    assert.equal(isQueueConfigured(), true);
  });
});

// --- queueConfig: worst path + URL resolution (no client construction) ---

test("queueConfig throws QueueNotConfiguredError when not opted in", () => {
  withEnv(
    { QUEUE_ENABLED: undefined, QUEUE_DATABASE_URL: undefined, DATABASE_URL: TEST_URL },
    () => {
      assert.throws(() => queueConfig(), QueueNotConfiguredError);
    },
  );
});

test("queueConfig throws QueueNotConfiguredError when enabled without a URL", () => {
  withEnv({ QUEUE_ENABLED: "true", QUEUE_DATABASE_URL: undefined, DATABASE_URL: undefined }, () => {
    assert.throws(() => queueConfig(), QueueNotConfiguredError);
  });
});

test("QueueNotConfiguredError names the vars to set (actionable, no partial config)", () => {
  withEnv(
    { QUEUE_ENABLED: undefined, QUEUE_DATABASE_URL: undefined, DATABASE_URL: undefined },
    () => {
      try {
        queueConfig();
        assert.fail("expected queueConfig() to throw");
      } catch (err) {
        assert.ok(err instanceof QueueNotConfiguredError);
        assert.equal(err.name, "QueueNotConfiguredError");
        assert.match(err.message, /QUEUE_ENABLED/);
        assert.match(err.message, /QUEUE_DATABASE_URL/);
      }
    },
  );
});

test("queueConfig prefers QUEUE_DATABASE_URL over DATABASE_URL", () => {
  withEnv({ QUEUE_ENABLED: "true", QUEUE_DATABASE_URL: QUEUE_URL, DATABASE_URL: TEST_URL }, () => {
    assert.equal(queueConfig().connectionString, QUEUE_URL);
  });
});

test("queueConfig falls back to DATABASE_URL when QUEUE_DATABASE_URL is unset", () => {
  withEnv({ QUEUE_ENABLED: "true", QUEUE_DATABASE_URL: undefined, DATABASE_URL: TEST_URL }, () => {
    assert.equal(queueConfig().connectionString, TEST_URL);
  });
});

// --- client worst paths: typed rejection BEFORE any pg-boss construction ---

test("getQueue rejects with QueueNotConfiguredError when unconfigured", async () => {
  await withEnv(
    { QUEUE_ENABLED: undefined, QUEUE_DATABASE_URL: undefined, DATABASE_URL: TEST_URL },
    async () => {
      await assert.rejects(getQueue(), QueueNotConfiguredError);
    },
  );
});

test("sendJob rejects with QueueNotConfiguredError when unconfigured", async () => {
  await withEnv(
    { QUEUE_ENABLED: undefined, QUEUE_DATABASE_URL: undefined, DATABASE_URL: TEST_URL },
    async () => {
      await assert.rejects(sendJob("email-welcome", { to: "a@b.c" }), QueueNotConfiguredError);
    },
  );
});

test("registerWorker rejects with QueueNotConfiguredError when unconfigured", async () => {
  await withEnv(
    { QUEUE_ENABLED: undefined, QUEUE_DATABASE_URL: undefined, DATABASE_URL: TEST_URL },
    async () => {
      await assert.rejects(
        registerWorker("email-welcome", async () => undefined),
        QueueNotConfiguredError,
      );
    },
  );
});

test("sendJob rejects even when enabled but no database URL exists", async () => {
  await withEnv(
    { QUEUE_ENABLED: "true", QUEUE_DATABASE_URL: undefined, DATABASE_URL: undefined },
    async () => {
      await assert.rejects(sendJob("email-welcome", {}), QueueNotConfiguredError);
    },
  );
});

// --- teardown: safe to call unconditionally ---

test("stopQueue is a no-op (resolves) when the queue never started", async () => {
  await withEnv(
    { QUEUE_ENABLED: undefined, QUEUE_DATABASE_URL: undefined, DATABASE_URL: undefined },
    async () => {
      await assert.doesNotReject(stopQueue());
    },
  );
});
