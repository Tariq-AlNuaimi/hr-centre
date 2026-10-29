import type { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { forbidden, ok } from "@/lib/api-response";
import { paginatedResponse, parsePagination } from "@/lib/pagination";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/core/actor";
import { visibleImportKinds } from "@/lib/core/imports/record";
import { holdsGroup, jmlActor } from "@/lib/jml/access";
import { holdsAnywhere } from "@/lib/hiring/access";
import { resolveHiringActor } from "@/lib/hiring/actor";

/**
 * Admin › Imports (ADR-096): every import run of the kinds this viewer may see,
 * newest first — counts and who/when, never row contents.
 */
export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const [actor, jml, hiring] = await Promise.all([
      resolveActor(session),
      jmlActor(session),
      resolveHiringActor(session),
    ]);
    const kinds = visibleImportKinds({
      peopleImport: actor.capabilities.previewImport,
      jmlConfigure: holdsGroup(jml, "jml.configure"),
      hiringManage: holdsAnywhere(hiring, "hiring.manage"),
    });
    if (kinds.length === 0) return forbidden();
    const pagination = parsePagination(request.nextUrl.searchParams);
    const where = { kind: { in: kinds } };
    const [rows, total] = await Promise.all([
      prisma.importBatch.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          kind: true,
          filename: true,
          status: true,
          uploadedByEmail: true,
          uploadedBy: { select: { name: true, email: true } },
          rowsTotal: true,
          rowsCreated: true,
          rowsUpdated: true,
          rowsRejected: true,
          createdAt: true,
        },
      }),
      prisma.importBatch.count({ where }),
    ]);
    return ok({ kinds, ...paginatedResponse(rows, total, pagination) });
  }),
  { id: "imports-history", limit: 60, windowMs: 60_000 },
);
