import { NextRequest } from "next/server";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, forbidden, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { createEntitySchema } from "@/lib/validations/employee";

/**
 * Org entities — spec §1.2 (Rihal parent, TP and CL subsidiaries).
 *
 * Readable by any authenticated user: entity names are org structure, not
 * personnel data, and every directory filter and department form needs them.
 * Writable only by HR Super Admin (§4.1's configure column).
 */

export const GET = withRateLimit(
  withAuth(async () => {
    const entities = await prisma.orgEntity.findMany({
      orderBy: { code: "asc" },
      // Bounded: the spec describes three entities and the model exists so a
      // fourth is data rather than a migration — not so it can grow unbounded.
      take: 100,
      select: {
        id: true,
        code: true,
        name: true,
        _count: { select: { departments: true, employees: true } },
      },
    });
    return ok(entities);
  }),
  { id: "pms-entities-list", limit: 120, windowMs: 60_000 },
);

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    if (!actor.capabilities.configure) return forbidden();

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");
    const parsed = createEntitySchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }

    const existing = await prisma.orgEntity.findUnique({
      where: { code: parsed.data.code },
      select: { id: true },
    });
    if (existing) return err(`An entity with code "${parsed.data.code}" already exists`, 409);

    const entity = await prisma.orgEntity.create({
      data: parsed.data,
      select: { id: true, code: true, name: true },
    });
    return created(entity);
  }),
  { id: "pms-entities-write", limit: 20, windowMs: 60_000 },
);
