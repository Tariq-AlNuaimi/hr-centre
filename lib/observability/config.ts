// lib/observability/config.ts — OpenTelemetry configuration seam (ADR-040).
//
// Reads the OTLP config from process.env DIRECTLY (not lib/env.ts) so it works
// identically on the Node and Edge runtimes: instrumentation.ts runs once per
// process on BOTH runtimes at boot, and the Edge runtime never imports the
// zod-parsed lib/env. The vars are still declared in lib/env.ts for the env
// contract; this module is the single source of truth for "is OTel on and how".
//
// The controlling switch is OTEL_EXPORTER_OTLP_ENDPOINT: when it is set the SDK
// is registered and OTLP is exported; when it is unset the whole backbone is a
// silent no-op with zero overhead (AC-5.1). The endpoint points at an OTel
// Collector (the swappable-backend seam) or directly at a SigNoz/OTLP sink —
// swapping the backend is a deploy-time config change, never an app-code diff.

/** Default service name when OTEL_SERVICE_NAME is not provided. */
const DEFAULT_SERVICE_NAME = "app";

/**
 * True when an OTLP endpoint is configured. This is the ONLY gate that decides
 * whether the OTel SDK is registered — keep instrumentation.ts and any future
 * consumer routed through here so the "no endpoint => zero overhead" invariant
 * (AC-5.1) has one definition.
 */
export function isOtelEnabled(): boolean {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  return typeof endpoint === "string" && endpoint.trim().length > 0;
}

/** Service name reported to the trace backend (OTEL_SERVICE_NAME or a default). */
export function otelServiceName(): string {
  const name = process.env.OTEL_SERVICE_NAME;
  return name && name.trim().length > 0 ? name.trim() : DEFAULT_SERVICE_NAME;
}
