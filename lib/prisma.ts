import { createBaseClient } from "./prisma/client";
import { softDeleteExtension } from "./prisma/soft-delete-extension";
import { auditExtension } from "./prisma/audit-extension";

const globalForPrisma = globalThis as unknown as {
  prismaBase: ReturnType<typeof createBaseClient> | undefined;
};

// ONE base client -> one pg pool per process. `$extends` returns a facade over
// the same engine/pool, so `prisma` and `prismaUnfiltered` share connections
// instead of each opening their own pool (halves connections against Neon and
// cold-start instantiation on serverless). Extensions apply only to the
// `prisma` facade -- `prismaUnfiltered` stays raw by construction.
const base = globalForPrisma.prismaBase ?? createBaseClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = base;
}

/**
 * Main Prisma client with soft-delete filtering and audit trail.
 * Use this for all normal application queries.
 *
 * The soft-delete extension is the outermost hook for `delete`/`deleteMany`
 * and rewrites them to `update` on the base client, so the audit extension
 * never sees soft deletes -- the soft-delete extension records those audit
 * rows itself (see soft-delete-extension.ts). create/update flow through the
 * audit extension normally.
 */
export const prisma = base.$extends(softDeleteExtension).$extends(auditExtension);

/**
 * Unfiltered Prisma client without soft-delete filtering.
 * Use this for the recycling bin, admin queries, and Auth.js adapter.
 */
export const prismaUnfiltered = base;
