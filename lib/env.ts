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

  // Scoring microservice (ARCHITECTURE §12.2). The deterministic IPIP-NEO-120
  // scorer is a separate Python service (services/scoring) reached over HTTP --
  // no Vercel lock-in. URL is optional/dormant until the scorer is deployed;
  // lib/scoring.isScoringConfigured() gates on it. TOKEN, when set, is sent as a
  // Bearer header and must match the service's SCORING_SERVICE_TOKEN.
  SCORING_SERVICE_URL: z.string().url().optional(),
  SCORING_SERVICE_TOKEN: z.string().optional(),

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
});

export const env = envSchema.parse(process.env);
