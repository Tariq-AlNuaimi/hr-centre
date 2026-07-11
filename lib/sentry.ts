// lib/sentry.ts — Project-side Sentry wrapper.
//
// All app code that wants to send an error to Sentry goes through
// `captureError` (NOT `Sentry.captureException` directly) so the context
// payload is scrubbed of Restricted field names before it leaves the
// process. The scrub set is the same `SCRUB_FIELDS` used by the audit
// extension (see lib/prisma/audit-extension.ts + SECURITY.md §5) — we
// import it rather than duplicate to keep the two surfaces in lock-step.
//
// `setUserContext` sets ONLY the user id on the Sentry scope. Email / name
// would be Confidential per SECURITY.md §1; we deliberately omit them so a
// future Sentry breach cannot leak operator PII.
//
// Compatibility note: this file depends on `@sentry/nextjs` 10.x, which
// supports Next.js 16 per its peerDependencies. If a future Next major
// outpaces the SDK, pin Sentry to the highest version that lists Next in
// peerDependencies and document the constraint here.

import * as DefaultSentry from "@sentry/nextjs";
import { SCRUB_FIELDS } from "./prisma/audit-extension";

/**
 * Minimal surface we use from @sentry/nextjs. Defined as a type so the
 * contract test can substitute an in-memory stub without monkey-patching
 * the real module loader (avoids needing --experimental-test-module-mocks
 * for `node:test`).
 */
type SentryLike = {
  captureException: (err: unknown) => unknown;
  withScope: (
    fn: (scope: { setContext: (key: string, value: Record<string, unknown>) => void }) => void,
  ) => void;
  setUser: (user: { id: string } | null) => void;
};

let sentryImpl: SentryLike = DefaultSentry as unknown as SentryLike;

/**
 * Test seam: replace the Sentry implementation. Production code never calls
 * this. Restore to default by calling without an argument.
 */
export function _setSentryForTesting(impl?: SentryLike): void {
  sentryImpl = impl ?? (DefaultSentry as unknown as SentryLike);
}

/**
 * Recursively replace values for every key in SCRUB_FIELDS with "[redacted]".
 * Exported so the contract test can assert it directly without mocking the
 * Sentry SDK (see tests/contracts/sentry-scrub.test.ts).
 */
export function scrubContext(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!input) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SCRUB_FIELDS.has(k)) {
      out[k] = v == null ? v : "[redacted]";
    } else if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      out[k] = scrubContext(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Send an error to Sentry, with context payload scrubbed for Restricted
 * field names per the audit extension's SCRUB_FIELDS set.
 *
 * Safe to call when Sentry is unconfigured (no DSN) — Sentry's SDK no-ops.
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  const scrubbed = scrubContext(context);
  if (scrubbed) {
    sentryImpl.withScope((scope) => {
      scope.setContext("app", scrubbed);
      sentryImpl.captureException(err);
    });
  } else {
    sentryImpl.captureException(err);
  }
}

/**
 * Attach (or clear) the current user id on the Sentry scope. We only pass
 * `id` — email / name are Confidential (SECURITY.md §1) and never leave
 * the process via Sentry.
 *
 * Pass `null` to clear, e.g. on sign-out.
 */
export function setUserContext(userId: string | null): void {
  if (userId === null) {
    sentryImpl.setUser(null);
  } else {
    sentryImpl.setUser({ id: userId });
  }
}
