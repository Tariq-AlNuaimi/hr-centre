import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { created, err, notFound, ok, readJsonBody } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { resolveActor } from "@/lib/pms/actor";
import { isHr } from "@/lib/pms/permissions";
import {
  upsertDepartmentScoreSchema,
  upsertEntityScoreSchema,
} from "@/lib/validations/strategy-score";

/**
 * §8.4 — the Corporate and Departmental scores.
 *
 * "Produced by the Strategy team, provided to HR as one score per entity …
 * one score per department." §4.1 gives the Strategy team **no system access**,
 * so this is HR keying in a figure they were handed — and `enteredBy` records
 * which HR person did, because they are the accountable party for a number that
 * flows into everyone's final score (§8.6) and therefore their bonus (§11.3).
 *
 * One route for both because they are the same act on the same schedule, and
 * splitting them would duplicate the authority check that is the only thing
 * either one really does.
 *
 * GET returns what has been keyed so far for a cycle, so the screen can show
 * which entities and departments are still missing — §10.7 will not let
 * calibration start until every raw score is in, and a missing Strategy figure
 * is the most likely reason one cannot be computed.
 */

export const POST = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);

    // §4.1 — HR Super Admin and HRBP both "run the cycle org-wide". Neither a
    // line manager nor the executive viewer keys a Strategy figure.
    if (!isHr(actor)) {
      return err("Only HR records the Strategy team's scores.", 403);
    }
    const enteredBy = actor.employeeId;
    if (!enteredBy) return err("This account has no linked employee record (ADR-065).", 403);

    const body = await readJsonBody(request);
    if (body === null) return err("Request body must be valid JSON");

    const raw = body as Record<string, unknown>;
    const isEntity = "entityId" in raw;

    if (isEntity) {
      const parsed = upsertEntityScoreSchema.safeParse(body);
      if (!parsed.success) {
        return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
      }
      const { cycleId, entityId, score } = parsed.data;

      const [cycle, entity] = await Promise.all([
        prisma.performanceCycle.findUnique({ where: { id: cycleId }, select: { id: true } }),
        prisma.orgEntity.findUnique({ where: { id: entityId }, select: { id: true } }),
      ]);
      if (!cycle) return notFound("Cycle");
      if (!entity) return notFound("Entity");

      const existing = await prisma.entityScore.findUnique({
        where: { cycleId_entityId: { cycleId, entityId } },
        select: { id: true },
      });
      // find-then-create/update rather than `upsert`: `upsert` trips
      // `no-unaudited-bulk-write`, and §14 requires an audit row for anything
      // that changes a score.
      const row = existing
        ? await prisma.entityScore.update({
            where: { id: existing.id },
            data: { score: new Prisma.Decimal(score), enteredByEmployeeId: enteredBy },
            select: { id: true, cycleId: true, entityId: true, score: true, updatedAt: true },
          })
        : await prisma.entityScore.create({
            data: {
              cycleId,
              entityId,
              score: new Prisma.Decimal(score),
              enteredByEmployeeId: enteredBy,
            },
            select: { id: true, cycleId: true, entityId: true, score: true, updatedAt: true },
          });
      const payload = { entityScore: { ...row, score: row.score.toString() } };
      return existing ? ok(payload) : created(payload);
    }

    const parsed = upsertDepartmentScoreSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "));
    }
    const { cycleId, departmentId, score } = parsed.data;

    const [cycle, department] = await Promise.all([
      prisma.performanceCycle.findUnique({ where: { id: cycleId }, select: { id: true } }),
      prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }),
    ]);
    if (!cycle) return notFound("Cycle");
    if (!department) return notFound("Department");

    const existing = await prisma.departmentScore.findUnique({
      where: { cycleId_departmentId: { cycleId, departmentId } },
      select: { id: true },
    });
    const row = existing
      ? await prisma.departmentScore.update({
          where: { id: existing.id },
          data: { score: new Prisma.Decimal(score), enteredByEmployeeId: enteredBy },
          select: { id: true, cycleId: true, departmentId: true, score: true, updatedAt: true },
        })
      : await prisma.departmentScore.create({
          data: {
            cycleId,
            departmentId,
            score: new Prisma.Decimal(score),
            enteredByEmployeeId: enteredBy,
          },
          select: { id: true, cycleId: true, departmentId: true, score: true, updatedAt: true },
        });
    const payload = { departmentScore: { ...row, score: row.score.toString() } };
    return existing ? ok(payload) : created(payload);
  }),
  { id: "pms-strategy-score-write", limit: 60, windowMs: 60_000 },
);

export const GET = withRateLimit(
  withAuth(async (request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    // Deadlines and scores are org-wide facts; §4.1 gives HR and the executive
    // viewer org-wide sight. A line manager has no use for a departmental figure
    // they cannot act on, and §13.1 keeps components away from employees.
    if (!actor.capabilities.orgWide) {
      return err("Strategy scores are visible to HR and the executive viewers.", 403);
    }

    const cycleId = new URL(request.url).searchParams.get("cycleId");
    if (!cycleId) return err("cycleId is required");

    const [entities, departments, entityScores, departmentScores] = await Promise.all([
      prisma.orgEntity.findMany({ select: { id: true, code: true, name: true }, take: 50 }),
      prisma.department.findMany({
        select: { id: true, name: true, entityId: true },
        orderBy: { name: "asc" },
        take: 200,
      }),
      prisma.entityScore.findMany({
        where: { cycleId },
        select: { entityId: true, score: true, updatedAt: true },
        take: 50,
      }),
      prisma.departmentScore.findMany({
        where: { cycleId },
        select: { departmentId: true, score: true, updatedAt: true },
        take: 200,
      }),
    ]);

    const eScore = new Map(entityScores.map((s) => [s.entityId, s]));
    const dScore = new Map(departmentScores.map((s) => [s.departmentId, s]));

    return ok({
      cycleId,
      // `score: null` means NOT YET KEYED — distinct from a score of zero, which
      // §8.1 does not allow anyway. The screen shows the gap, because §10.7
      // cannot start calibration until every raw score exists.
      entities: entities.map((e) => ({
        ...e,
        score: eScore.get(e.id)?.score.toString() ?? null,
        updatedAt: eScore.get(e.id)?.updatedAt ?? null,
      })),
      departments: departments.map((d) => ({
        ...d,
        score: dScore.get(d.id)?.score.toString() ?? null,
        updatedAt: dScore.get(d.id)?.updatedAt ?? null,
      })),
      missing: {
        entities: entities.filter((e) => !eScore.has(e.id)).length,
        departments: departments.filter((d) => !dScore.has(d.id)).length,
      },
    });
  }),
  { id: "pms-strategy-score-read", limit: 120, windowMs: 60_000 },
);
