// lib/sso/config.ts — the enterprise-identity runtime gate (ADR-045).
//
// WS-6 adds SAML→OIDC (via an Ory Polis sidecar) + SCIM 2.0 directory
// provisioning. Like lib/ai/config.ts (ADR-036) and lib/observability/config.ts
// (ADR-040), this module reads process.env DIRECTLY at CALL time — not the
// zod-parsed lib/env — so the gate is Edge-safe and has one definition of "is
// identity configured and how". The POLIS_*/SCIM_* vars are still declared in
// lib/env.ts for the env contract + loud boot validation; this module is the
// runtime source of truth.
//
// Silent no-op by default: with no env set, isPolisSsoConfigured() is false (SSO
// dormant, no provider registered) and the SCIM endpoint's withInternalAuth gate
// returns { skipped: true }. A fork opts in per deployment by setting env.

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Resolved Polis SAML→OIDC provider config (only valid when configured). Polis
 * bridges a tenant's SAML into a standard OIDC endpoint, so Auth.js consumes it
 * as an ordinary OIDC provider (issuer = Polis /.well-known/openid-configuration).
 */
export interface PolisSsoConfig {
  /** Polis base issuer URL, e.g. http://polis:5225 (exposes /.well-known). */
  issuer: string;
  /** OIDC client id of the app's SSO connection in Polis. */
  clientId: string;
  /** OIDC client secret. Restricted — never logged. */
  clientSecret: string;
  /** Optional Polis SAML connection selectors (deploy-per-tenant bakes these). */
  tenant: string | undefined;
  product: string | undefined;
}

/**
 * True when the Polis SSO provider has everything it needs. issuer + id + secret
 * are required TOGETHER — a half-config renders a broken sign-in button, and it
 * mirrors the Entra three-var gate in lib/auth.ts (ADR-024). This is the single
 * gate that decides whether the OIDC provider registers.
 */
export function isPolisSsoConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(
    env.POLIS_ISSUER?.trim() &&
      env.POLIS_CLIENT_ID?.trim() &&
      env.POLIS_CLIENT_SECRET?.trim(),
  );
}

/**
 * The resolved Polis SSO config. Throws {@link SsoNotConfiguredError} when
 * unconfigured — call {@link isPolisSsoConfigured} first to branch without
 * throwing. issuer/id/secret/tenant/product all come from env, so wiring a new
 * tenant IdP is a deploy-time change, never an app-code diff.
 */
export function polisSsoConfig(env: Record<string, string | undefined> = process.env): PolisSsoConfig {
  if (!isPolisSsoConfigured(env)) throw new SsoNotConfiguredError();
  return {
    issuer: env.POLIS_ISSUER!.trim(),
    clientId: env.POLIS_CLIENT_ID!.trim(),
    clientSecret: env.POLIS_CLIENT_SECRET!,
    tenant: env.POLIS_SAML_TENANT?.trim() || undefined,
    product: env.POLIS_SAML_PRODUCT?.trim() || undefined,
  };
}

/**
 * The optional BoxyHQ dsync webhook secret. When set, the SCIM endpoint verifies
 * the HMAC signature on every event in addition to the withInternalAuth bearer
 * (defense in depth + the real Polis Directory Sync contract). Undefined => HMAC
 * verification is skipped (the withInternalAuth shared secret is the sole gate).
 */
export function scimWebhookSecret(env: Record<string, string | undefined> = process.env): string | undefined {
  const s = env.SCIM_WEBHOOK_SECRET?.trim();
  return s && s.length > 0 ? s : undefined;
}

/**
 * Verify a BoxyHQ Directory-Sync webhook signature. BoxyHQ signs the raw request
 * body with HMAC-SHA256(secret) and sends the hex digest in the `BoxyHQ-Signature`
 * header. Timing-safe compare; returns false on any missing/malformed input rather
 * than throwing, so the route can answer a clean 401.
 */
export function verifyScimSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  // BoxyHQ historically prefixed the digest (e.g. "t=..,s=<hex>"); accept a bare
  // hex digest or the `s=`/last-token form so a fork isn't wedged by a format bump.
  const provided = signature.includes("=")
    ? (signature.split(",").pop() ?? "").split("=").pop() ?? ""
    : signature.trim();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  // timingSafeEqual throws on length mismatch — guard so a wrong-length signature
  // is a plain false, still without an early-return timing side channel on equal
  // lengths.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Thrown when a Polis SSO operation is attempted with no POLIS_* config. Names the
 * missing vars so the fix is obvious and never leaks a partial config.
 */
export class SsoNotConfiguredError extends Error {
  constructor() {
    super(
      "Enterprise SSO is not configured: set POLIS_ISSUER + POLIS_CLIENT_ID + " +
        "POLIS_CLIENT_SECRET to enable the Ory Polis provider (see .env.example / " +
        "ADR-045). Guard optional SSO paths with isPolisSsoConfigured().",
    );
    this.name = "SsoNotConfiguredError";
  }
}
