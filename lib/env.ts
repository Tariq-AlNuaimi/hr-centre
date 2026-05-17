import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // MinIO
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1).default("uploads"),

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

  // Audit retention
  // AUDIT_PURGE_TOKEN gates /api/internal/audit-purge. Optional: when unset,
  // the endpoint returns 503 and the scheduled workflow skips with a warning.
  AUDIT_PURGE_TOKEN: z.string().min(32).optional(),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
});

export const env = envSchema.parse(process.env);
