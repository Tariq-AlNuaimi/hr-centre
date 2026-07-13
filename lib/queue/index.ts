// lib/queue/index.ts — the app-facing surface of the background-job seam.
// Import from "@/lib/queue", not the sub-modules.
//
// pg-boss on the existing Postgres (build-vs-buy ledger 2026-07-11; blueprint
// docs/blueprints/enterprise-queue-seam.md). Silent no-op until the operator
// sets QUEUE_ENABLED="true" — guard optional job paths with isQueueConfigured();
// unguarded use throws QueueNotConfiguredError before anything is constructed.

export { isQueueConfigured, queueConfig, QueueNotConfiguredError } from "./config";
export type { QueueConfig } from "./config";
export { getQueue, sendJob, registerWorker, stopQueue } from "./client";
export type { JobHandler } from "./client";
