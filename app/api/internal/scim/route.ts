import type { NextRequest } from "next/server";
import { ok, err } from "@/lib/api-response";
import { withInternalAuth, withRateLimit } from "@/lib/api-helpers";
import { withSpan } from "@/lib/observability";
import { scimWebhookSecret, verifyScimSignature } from "@/lib/sso/config";
import { normalizeDirectoryEvent, provisionDirectoryEvent } from "@/lib/sso/scim";
import { normalizedScimEventSchema } from "@/lib/validations/sso";

// Internal endpoint — SCIM 2.0 directory provisioning from an Ory Polis sidecar
// (ADR-045, WS-6). Ory Polis owns the SCIM protocol and POSTs BoxyHQ Directory-
// Sync ("dsync") webhook events here; this route maps them onto the User model
// (VIEWER on create, soft-delete on off-board) via lib/sso/scim.
//
// Two layered gates (both dormant by default => this template ships SCIM OFF):
//   1. withInternalAuth("SCIM_INTERNAL_SECRET", bearer): the template's shared-
//      secret machine-auth floor. While unset, skipWhenUnconfigured returns
//      200 { skipped: true } — silent dormancy, not a 503 on every unconfigured
//      call. The Polis webhook is fronted to send Authorization: Bearer <secret>.
//   2. Optional BoxyHQ HMAC: when SCIM_WEBHOOK_SECRET is set, the raw-body
//      HMAC-SHA256 signature is verified too (the native Polis dsync contract +
//      defense in depth). Verified BEFORE JSON parse, on the raw bytes.
//
// withRateLimit composes OUTSIDE withInternalAuth (OWASP A04) so a burst is
// throttled before auth/provisioning work runs. The limit is sized for a bulk
// initial directory sync and is operator-tunable.

async function handle(req: NextRequest) {
  // Read the raw body ONCE: HMAC must run on the exact bytes Polis signed, so we
  // cannot use req.json() (which would consume the stream first).
  const rawBody = await req.text();

  const secret = scimWebhookSecret();
  if (secret) {
    const signature =
      req.headers.get("boxyhq-signature") ?? req.headers.get("x-scim-signature");
    if (!verifyScimSignature(rawBody, signature, secret)) {
      return err("Invalid SCIM webhook signature", 401);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return err("Invalid JSON body", 400);
  }

  const candidate = normalizeDirectoryEvent(parsed);
  // Group events, membership events, or anything without an email are not acted
  // on — acknowledge with 200 so Polis does not retry a well-formed no-op.
  if (!candidate) return ok({ skipped: true, reason: "unhandled-event" });

  // Validate the normalized event at the API boundary (zod hard rule). The key
  // check normalize doesn't make: the address is a REAL email — a malformed value
  // is a 400, never a silently-provisioned bad users.email row.
  const validated = normalizedScimEventSchema.safeParse(candidate);
  if (!validated.success) return err("Invalid SCIM event payload", 400);

  const result = await withSpan("sso.scim.provision", () =>
    provisionDirectoryEvent(validated.data),
  );
  // Log the action only — never the email/name (PII stays out of logs).
  return ok({ action: result.action });
}

// Rate-limit sized for a bulk initial directory sync: a large org's first dsync
// POSTs one event per user in a burst. The limit is generous so provisioning is
// not silently dropped (429s a legitimate onboarding batch), while still capping a
// flood ahead of auth. NB the limiter is in-memory per-instance (ADR: Upstash via
// /scale-up when multi-instance); tune `limit` up for very large directories.
export const POST = withRateLimit(
  withInternalAuth("SCIM_INTERNAL_SECRET", handle, {
    bearer: true,
    skipWhenUnconfigured: true,
  }),
  { id: "scim-provision", limit: 1000, windowMs: 60_000 },
);
