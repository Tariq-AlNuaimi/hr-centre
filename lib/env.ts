import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Auth
  AUTH_SECRET: z.string().min(32), // matches `openssl rand -base64 32`; rejects a weak JWT signing key
  AUTH_URL: z.string().url().optional(),

  // App
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  NEXT_PUBLIC_APP_NAME: z.string().default("My App"),

  // Seeding
  SEED_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("changeme"),

  // Recycling bin -- soft-deleted records are permanently GC'd past this many
  // days by the daily audit-purge cron (app/api/internal/audit-purge), so
  // deleted PII does not linger in the bin forever.
  RECYCLE_BIN_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

  // Rate limiting (optional). Names the proxy's trusted real-client-IP header so
  // lib/rate-limit.ts can stop trusting the spoofable x-forwarded-for[0] -- e.g.
  // "cf-connecting-ip" (Cloudflare) or "x-real-ip" (Vercel/nginx). Unset = fall
  // back to x-real-ip then x-forwarded-for. Declared here for the env contract;
  // consumed in lib/rate-limit.ts. See .env.example + SECURITY.md finding T-01.
  RATE_LIMIT_TRUSTED_IP_HEADER: z.string().optional(),

  // Audit retention (ADR-018) -- two secrets gate /api/internal/audit-purge,
  // both optional and dormant until set, both with the same strength floor:
  // CRON_SECRET authorizes the daily Vercel Cron GET (Vercel auto-sends it as
  // `Authorization: Bearer`); AUDIT_PURGE_TOKEN authorizes manual / Actions
  // POSTs via `x-internal-token`. They may be set to the same value.
  CRON_SECRET: z.string().min(32).optional(),
  AUDIT_PURGE_TOKEN: z.string().min(32).optional(),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),

  // SMTP (optional; email is gated on SMTP_HOST presence -- see lib/email.ts)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),

  // Sentry (optional; observability is opt-in per project -- see ADR-002).
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default("development"),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),

  // OpenTelemetry (optional; ADR-040). The OTel SDK is registered in
  // instrumentation.ts ONLY when OTEL_EXPORTER_OTLP_ENDPOINT is set -- an
  // unconfigured deploy pays zero overhead (AC-5.1). The endpoint points at an
  // OTel Collector (the swappable-backend seam) or directly at a SigNoz/OTLP
  // sink; protocol defaults to http/protobuf. Declared here for the env
  // contract; the runtime gate lives in lib/observability/config.ts, which
  // reads process.env directly so it works on the Edge runtime too.
  // z.string().url() alone is too loose: the WHATWG URL parser reads a bare
  // "otel-collector:4318" as scheme `otel-collector:` with an empty host, so a
  // scheme-less typo would validate yet export nowhere (silent telemetry loss).
  // Require an absolute http(s) URL with a real host so a misconfig fails LOUD
  // at boot, like every other required env here.
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .url()
    .refine(
      (v) => {
        try {
          const u = new URL(v);
          return (
            (u.protocol === "http:" || u.protocol === "https:") &&
            u.hostname.length > 0
          );
        } catch {
          return false;
        }
      },
      { message: "must be an absolute http(s) URL with a host, e.g. http://otel-collector:4318" },
    )
    .optional(),
  OTEL_EXPORTER_OTLP_PROTOCOL: z
    .enum(["http/protobuf", "http/json", "grpc"])
    .optional(),
  OTEL_SERVICE_NAME: z.string().optional(),

  // AI runtime (optional; ADR-036, WS-5). The Claude-native AI layer (lib/ai/*)
  // is a silent no-op unless AI_API_KEY is set -- isAiConfigured() is false and
  // getAiClient() throws an actionable error rather than constructing a client
  // that would 401 at call time (mirrors the OTel no-op + email {sent:false}).
  // Endpoint-agnostic by operator decision (session 15): the same build targets
  // Anthropic's hosted API or a self-hosted LLM by config alone --
  //   AI_BASE_URL:   unset -> Anthropic's default; set -> a self-hosted /
  //                  Anthropic-compat gateway endpoint. Validated as an absolute
  //                  http(s) URL with a host (same rule as the OTLP endpoint) so
  //                  a scheme-less typo fails LOUD at boot, not silently nowhere.
  //   AI_AUTH_STYLE: how AI_API_KEY is sent -- "x-api-key" (Anthropic default)
  //                  or "bearer" (Authorization: Bearer, for a gateway/proxy).
  //   AI_MODEL:      default model/tier; a per-call override passes through
  //                  runAgent() (no automatic product-routing policy this phase).
  // Declared here for the env contract + boot-time validation; the runtime gate
  // lives in lib/ai/config.ts, which reads process.env directly (like the OTel
  // gate) so it evaluates at call time. The enum below is the AUTHORITATIVE
  // boot-time validator for AI_AUTH_STYLE (a bad value fails loud at startup);
  // lib/ai/config.ts owns the DEFAULTS, so no `.default()` is set here — one
  // owner per concern, mirroring how OTEL_SERVICE_NAME is undefaulted here and
  // defaulted in lib/observability/config.ts.
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z
    .string()
    .url()
    .refine(
      (v) => {
        try {
          const u = new URL(v);
          return (
            (u.protocol === "http:" || u.protocol === "https:") &&
            u.hostname.length > 0
          );
        } catch {
          return false;
        }
      },
      { message: "must be an absolute http(s) URL with a host, e.g. https://gateway.internal/anthropic" },
    )
    .optional(),
  AI_AUTH_STYLE: z.enum(["x-api-key", "bearer"]).optional(),
  AI_MODEL: z.string().optional(),
});

export const env = envSchema.parse(process.env);
