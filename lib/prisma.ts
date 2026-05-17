import { createBaseClient } from "./prisma/client";
import { softDeleteExtension } from "./prisma/soft-delete-extension";
import { auditExtension } from "./prisma/audit-extension";

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createExtendedClient> | undefined;
  prismaUnfiltered: ReturnType<typeof createBaseClient> | undefined;
};

function createExtendedClient() {
  const base = createBaseClient();
  // Order matters: soft-delete rewrites delete->update, then audit captures it
  return base.$extends(softDeleteExtension).$extends(auditExtension);
}

/**
 * Main Prisma client with soft-delete filtering and audit trail.
 * Use this for all normal application queries.
 */
export const prisma = globalForPrisma.prisma ?? createExtendedClient();

/**
 * Unfiltered Prisma client without soft-delete filtering.
 * Use this for the recycling bin, admin queries, and Auth.js adapter.
 */
export const prismaUnfiltered =
  globalForPrisma.prismaUnfiltered ?? createBaseClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaUnfiltered = prismaUnfiltered;
}
