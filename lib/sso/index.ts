// lib/sso — enterprise identity seam (ADR-045, WS-6): SAML→OIDC via an Ory Polis
// sidecar + SCIM 2.0 directory provisioning. Silent no-op until POLIS_*/SCIM_*
// env is set. The Auth.js provider wiring lives in lib/auth.ts (it consumes the
// gate below); this barrel re-exports the config gate + the SCIM provisioning
// primitives for the internal route and the contract tests.

export {
  isPolisSsoConfigured,
  polisSsoConfig,
  scimWebhookSecret,
  verifyScimSignature,
  isFederatedSignInAllowed,
  SsoNotConfiguredError,
  type PolisSsoConfig,
  type SsoSignInRow,
} from "./config";

export {
  normalizeDirectoryEvent,
  provisionDirectoryEvent,
  type NormalizedScimEvent,
  type ScimEventType,
  type ScimAction,
} from "./scim";
