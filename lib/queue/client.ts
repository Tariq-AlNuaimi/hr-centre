// lib/queue/client.ts — the lazily-started pg-boss singleton + thin job helpers.
//
// pg-boss rides the existing Postgres (build-vs-buy ledger, 2026-07-11 —
// Background job queue): no Redis, no SaaS scheduler, one datastore. Nothing in
// this module runs at import time — the singleton is constructed AND started
// only on the first getQueue() call, and only when the config gate says the
// operator opted in (QUEUE_ENABLED === "true"). Unconfigured use throws
// QueueNotConfiguredError before any client is constructed, mirroring
// lib/ai/provider.ts (never a half-initialized client that fails later).
//
// Unlike the AI client (cheap, stateless, rebuilt per call), pg-boss owns a
// connection pool + maintenance/polling loops, so it IS a module-level
// singleton here — one instance per process, torn down via stopQueue().

import { PgBoss, type Job, type SendOptions, type WorkOptions } from "pg-boss";

import { queueConfig } from "./config";

/** Handler shape pg-boss v12 workers receive: a batch (array) of jobs. */
export type JobHandler<T = object> = (jobs: Job<T>[]) => Promise<unknown>;

let instance: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;
/** Queues already ensured to exist this process (pg-boss v10+ requires createQueue before send). */
const ensuredQueues = new Set<string>();

/**
 * The started pg-boss singleton. First call constructs + `start()`s it from
 * {@link queueConfig}; later calls (including concurrent ones during startup)
 * share the same instance. Throws {@link QueueNotConfiguredError} when the
 * layer is off — check isQueueConfigured() first to branch without throwing.
 */
export async function getQueue(): Promise<PgBoss> {
  // Gate BEFORE construction: unconfigured => typed error, no client, no pool.
  const { connectionString } = queueConfig();
  if (instance) return instance;
  if (!starting) {
    // Declared `let ... | undefined = undefined` (not `const`): the closure
    // below compares against `attempt` after an await, by which point the real
    // assignment has run; a `const` self-reference fails TS2454.
    let attempt: Promise<PgBoss> | undefined = undefined;
    attempt = (async () => {
      const boss = new PgBoss(connectionString);
      // pg-boss emits internal maintenance/scheduling errors on this event; an
      // unhandled 'error' event would crash the Node process. Metadata only —
      // never the connection string (Confidential, SECURITY.md §1).
      boss.on("error", (error) => {
        console.error("[queue] pg-boss error:", error instanceof Error ? error.message : error);
      });
      await boss.start();
      // Cache only if this attempt is still current — if stopQueue() ran while
      // start() was in flight it already claimed this promise and will stop the
      // boss; caching here would resurrect a stopped client as the singleton.
      if (starting === attempt) instance = boss;
      return boss;
    })();
    starting = attempt;
    // Reset on failure so a later call can retry instead of caching the
    // rejection — but only if this attempt is still the current one, so a
    // late rejection can't clobber a newer retry's in-flight promise.
    attempt.catch(() => {
      if (starting === attempt) starting = null;
    });
  }
  return starting;
}

/** Create the queue on first use (pg-boss requires it before send/work); cached per name. */
async function ensureQueue(boss: PgBoss, name: string): Promise<void> {
  if (ensuredQueues.has(name)) return;
  if ((await boss.getQueue(name)) === null) {
    await boss.createQueue(name);
  }
  ensuredQueues.add(name);
}

/**
 * Enqueue a durable job. Thin wrapper over `boss.send()` that also creates the
 * queue on first use. Returns the job id (or null when a queue policy such as
 * `singleton` deduplicates the send). Throws {@link QueueNotConfiguredError}
 * when the layer is off.
 */
export async function sendJob(
  name: string,
  data: object,
  opts?: SendOptions,
): Promise<string | null> {
  const boss = await getQueue();
  await ensureQueue(boss, name);
  return boss.send(name, data, opts ?? {});
}

/**
 * Register a worker for a queue. Thin wrapper over `boss.work()` (the handler
 * receives a BATCH — an array of jobs). Returns the worker id. Throws
 * {@link QueueNotConfiguredError} when the layer is off. Workers belong in a
 * long-lived process (the Docker self-host rail / a dedicated worker entry) —
 * not in serverless route handlers, which are frozen between requests.
 */
export async function registerWorker<T = object>(
  name: string,
  handler: JobHandler<T>,
  opts?: WorkOptions,
): Promise<string> {
  const boss = await getQueue();
  await ensureQueue(boss, name);
  return opts ? boss.work<T>(name, opts, handler) : boss.work<T>(name, handler);
}

/**
 * Graceful teardown: waits for active jobs (pg-boss default timeout), closes
 * the pool, and resets the singleton so a later getQueue() can start fresh.
 * A no-op when the queue never started — safe to call unconditionally from
 * shutdown hooks and tests.
 */
export async function stopQueue(): Promise<void> {
  const pending = starting;
  instance = null;
  starting = null;
  ensuredQueues.clear();
  if (!pending) return;
  const boss = await pending.catch(() => null);
  if (boss) await boss.stop();
}
