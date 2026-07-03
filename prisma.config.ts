import path from "node:path";
import { defineConfig } from "prisma/config";

// `prisma generate` loads this config and resolves the datasource url even
// though codegen never opens a connection. prisma/config's `env()` THROWS when
// DATABASE_URL is unset, which broke standalone `npm run prisma:generate` in a
// fresh checkout (PrismaConfigEnvError). Fall back to a non-connecting
// placeholder so generate always works; migrate/seed/deploy still use the real
// DATABASE_URL from the environment (and fail loudly with a connection error,
// not a config-load error, if it's genuinely missing).
export default defineConfig({
  schema: path.join(import.meta.dirname, "prisma", "schema.prisma"),
  migrations: {
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
