// lib/queue/config.ts — the background-job runtime gate + typed config.
//
// The queue layer (lib/queue/*) is a silent no-op unless EXPLICITLY enabled:
// isQueueConfigured() requires QUEUE_ENABLED === "true" AND a database URL
// (QUEUE_DATABASE_URL, falling back to DATABASE_URL). The explicit QUEUE_ENABLED
// opt-in is a deliberate design decision — a Postgres URL is always present in
// this stack, so gating on the URL alone would silently start pg-boss polling
// the app database on every deploy. Nothing background-shaped starts unless the
// operator asks for it. This mirrors the AI (ADR-036) / OTel (ADR-040) seams:
// unconfigured => honest, actionable failure; never a half-initialized client.
//
// Like lib/ai/config.ts and lib/observability/config.ts, this reads process.env
// DIRECTLY (not the zod-parsed lib/env) so the gate evaluates at CALL time —
// one definition of "is the queue on and where", and no coupling to lib/env's
// import-time parse. The QUEUE_* vars are still declared in lib/env.ts for the
// env contract + loud boot-time validation (a typo'd QUEUE_ENABLED value or a
// malformed QUEUE_DATABASE_URL fails startup there); this module is the runtime
// source of truth. See the
// build-vs-buy ledger entry (2026-07-11 — Background job queue, pg-boss).

/** Resolved queue config (only valid when configured). */
export interface QueueConfig {
  /**
   * Postgres connection string pg-boss stores its job tables in.
   * QUEUE_DATABASE_URL when set (a dedicated DB/role), else DATABASE_URL.
   * Confidential — embeds the DB credential; never logged (SECURITY.md §1).
   */
  connectionString: string;
}

function databaseUrl(): string | undefined {
  const dedicated = process.env.QUEUE_DATABASE_URL;
  if (typeof dedicated === "string" && dedicated.trim().length > 0) return dedicated.trim();
  const shared = process.env.DATABASE_URL;
  if (typeof shared === "string" && shared.trim().length > 0) return shared.trim();
  return undefined;
}

/**
 * True when the queue layer may run: QUEUE_ENABLED === "true" (the explicit
 * opt-in — exactly the string "true", validated loud at boot by lib/env.ts)
 * AND a database URL is available. This is the ONLY gate that decides whether
 * pg-boss constructs — keep every consumer routed through here so the
 * "not enabled => nothing starts polling" invariant has one definition.
 */
export function isQueueConfigured(): boolean {
  return process.env.QUEUE_ENABLED === "true" && databaseUrl() !== undefined;
}

/**
 * The resolved config. Throws {@link QueueNotConfiguredError} when unconfigured —
 * call {@link isQueueConfigured} first if you need to branch without throwing.
 */
export function queueConfig(): QueueConfig {
  const connectionString = databaseUrl();
  if (process.env.QUEUE_ENABLED !== "true" || connectionString === undefined) {
    throw new QueueNotConfiguredError();
  }
  return { connectionString };
}

/**
 * Thrown when a queue operation is attempted while the layer is off. Names the
 * missing vars so the fix is obvious and never leaks a partial config.
 */
export class QueueNotConfiguredError extends Error {
  constructor() {
    super(
      'Background-job queue is not configured: set QUEUE_ENABLED="true" (and optionally ' +
        "QUEUE_DATABASE_URL; DATABASE_URL is the fallback) to enable lib/queue " +
        "(see .env.example). Guard optional job paths with isQueueConfigured().",
    );
    this.name = "QueueNotConfiguredError";
  }
}
