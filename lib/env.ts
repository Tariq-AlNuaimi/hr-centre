import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Auth
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().url().optional(),

  // App
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  NEXT_PUBLIC_APP_NAME: z.string().default("My App"),

  // Seeding
  SEED_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  SEED_ADMIN_PASSWORD: z.string().min(6).default("changeme"),

  // Recycling bin
  RECYCLE_BIN_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

  // Audit retention -- AUDIT_PURGE_TOKEN gates /api/internal/audit-purge.
  // Optional: when unset, the endpoint returns 503. Wire Vercel Cron to call
  // it monthly once set (see /scale-up).
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
});

export const env = envSchema.parse(process.env);
