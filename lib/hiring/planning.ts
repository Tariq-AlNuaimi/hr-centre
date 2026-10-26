import type { HiringNeedStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/rbac/catalogue";
import { can, type HiringActor } from "./access";
import { HiringRuleError } from "./http";
import { orgNames, peopleById, personOrNull } from "./people";
import {
  NEEDS_PER_ROUND_LIMIT,
  NOTES_PER_NEED_LIMIT,
  canRaiseRequisition,
  chaseableNeedIds,
  lastContact,
  stampsFor,
  summarizeRound,
} from "./planning-rules";
import { companyScope } from "./scope";

/** Step 1 — workforce planning service (Interview Hub `workforce-planning.ts` + routes). */

/** A round is scoped by its company. Null = 404. */
export async function loadRound(actor: HiringActor, id: string, permission: Permission) {
  const round = await prisma.hiringPlanningRound.findUnique({ where: { id } });
  if (!round || !can(actor, permission, { entityId: round.entityId })) return null;
  return round;
}

export async function listRounds(
  actor: HiringActor,
  entityId: string | undefined,
  page: { skip: number; take: number },
) {
  const scope = companyScope(actor, "hiring.view");
  const ids = entityId ? (scope === null || scope.includes(entityId) ? [entityId] : []) : scope;
  if (ids !== null && ids.length === 0) return { data: [], total: 0 };
  const where = ids === null ? {} : { entityId: { in: ids } };
  const [rows, total] = await Promise.all([
    prisma.hiringPlanningRound.findMany({
      where,
      orderBy: [{ openedAt: "desc" }, { id: "desc" }],
      skip: page.skip,
      take: page.take,
      include: { _count: { select: { needs: true } } },
    }),
    prisma.hiringPlanningRound.count({ where }),
  ]);
  const org = await orgNames(
    rows.map((r) => r.entityId),
    [],
  );
  return {
    data: rows.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      entity: org.entities.get(r.entityId) ?? null,
      needCount: r._count.needs,
    })),
    total,
  };
}

export async function roundView(actor: HiringActor, roundId: string) {
  const round = await loadRound(actor, roundId, "hiring.view");
  if (!round) return null;
  const [needs, needTotal] = await Promise.all([
    prisma.hiringDepartmentNeed.findMany({
      where: { roundId },
      take: NEEDS_PER_ROUND_LIMIT,
      include: {
        _count: { select: { notes: true } },
        requisitions: { select: { id: true, title: true, status: true }, take: 20 },
      },
    }),
    prisma.hiringDepartmentNeed.count({ where: { roundId } }),
  ]);
  const [org, people] = await Promise.all([
    orgNames(
      [round.entityId],
      needs.map((n) => n.departmentId),
    ),
    peopleById(needs.map((n) => n.ownerId)),
  ]);
  const rows = needs
    .map((n) => {
      const gate = canRaiseRequisition(n);
      return {
        id: n.id,
        departmentId: n.departmentId,
        department: org.departments.get(n.departmentId) ?? "—",
        owner: personOrNull(people, n.ownerId),
        status: n.status,
        rolesRequested: n.rolesRequested,
        agreedRoles: n.agreedRoles,
        lastContact: lastContact(n),
        noteCount: n._count.notes,
        raised: n.requisitions,
        blockedReason: gate.ok ? null : gate.reason,
      };
    })
    .sort((a, b) => a.department.localeCompare(b.department));
  return {
    id: round.id,
    label: round.label,
    status: round.status,
    openedAt: round.openedAt,
    entity: org.entities.get(round.entityId) ?? null,
    needs: rows,
    stats: summarizeRound(rows.map((r) => ({ ...r, raised: r.raised.length > 0 }))),
    truncated: needTotal > rows.length,
    canManage: can(actor, "hiring.manage", { entityId: round.entityId }),
  };
}

export async function createRound(
  actor: HiringActor,
  input: { entityId: string; label: string; openedAt?: Date },
) {
  if (!can(actor, "hiring.manage", { entityId: input.entityId })) {
    throw new HiringRuleError("You can only open a planning cycle for a company you manage.", 403);
  }
  const dup = await prisma.hiringPlanningRound.findUnique({
    where: { entityId_label: { entityId: input.entityId, label: input.label } },
    select: { id: true },
  });
  if (dup)
    throw new HiringRuleError("A cycle with this label already exists for this company.", 409);
  return prisma.hiringPlanningRound.create({
    data: {
      entityId: input.entityId,
      label: input.label,
      openedAt: input.openedAt ?? new Date(),
      createdById: actor.userId,
    },
  });
}

export async function updateRound(
  id: string,
  current: { status: string },
  input: { label?: string; status?: "OPEN" | "CLOSED" },
) {
  if (input.status && input.status === current.status) {
    throw new HiringRuleError(`This cycle is already ${input.status.toLowerCase()}.`, 400);
  }
  return prisma.hiringPlanningRound.update({
    where: { id },
    data: {
      ...(input.label ? { label: input.label } : {}),
      ...(input.status
        ? { status: input.status, closedAt: input.status === "CLOSED" ? new Date() : null }
        : {}),
    },
  });
}

function assertOpen(round: { status: string }) {
  if (round.status !== "OPEN")
    throw new HiringRuleError("This planning cycle is closed. Reopen it to make changes.", 409);
}

export async function addNeed(
  round: { id: string; status: string; entityId: string },
  input: { departmentId: string; ownerId?: string | null },
) {
  assertOpen(round);
  const dept = await prisma.department.findFirst({
    where: { id: input.departmentId, entityId: round.entityId, deletedAt: null },
    select: { id: true },
  });
  if (!dept) throw new HiringRuleError("That department is not part of this cycle's company.", 400);
  const count = await prisma.hiringDepartmentNeed.count({ where: { roundId: round.id } });
  if (count >= NEEDS_PER_ROUND_LIMIT)
    throw new HiringRuleError(
      `A cycle canvasses at most ${NEEDS_PER_ROUND_LIMIT} departments.`,
      409,
    );
  const dup = await prisma.hiringDepartmentNeed.findUnique({
    where: { roundId_departmentId: { roundId: round.id, departmentId: input.departmentId } },
    select: { id: true },
  });
  if (dup) throw new HiringRuleError("This department is already in the cycle.", 409);
  return prisma.hiringDepartmentNeed.create({
    data: { roundId: round.id, departmentId: input.departmentId, ownerId: input.ownerId ?? null },
  });
}

export async function chaseRound(round: { id: string; status: string }) {
  assertOpen(round);
  const needs = await prisma.hiringDepartmentNeed.findMany({
    where: { roundId: round.id },
    select: { id: true, status: true, rolesRequested: true },
    take: NEEDS_PER_ROUND_LIMIT,
  });
  const ids = chaseableNeedIds(needs);
  const now = new Date();
  for (const id of ids) {
    await prisma.hiringDepartmentNeed.update({
      where: { id },
      data: { status: "NO_RESPONSE", chasedAt: now },
    });
  }
  return { chased: ids.length };
}

/** A need and its round, scoped by the round's company + the need's department. */
export async function loadNeed(actor: HiringActor, id: string, permission: Permission) {
  const need = await prisma.hiringDepartmentNeed.findUnique({
    where: { id },
    include: { round: true },
  });
  if (!need) return null;
  return can(actor, permission, { entityId: need.round.entityId, departmentId: need.departmentId })
    ? need
    : null;
}

export async function updateNeed(
  need: { id: string; round: { status: string } },
  input: {
    status?: HiringNeedStatus;
    ownerId?: string | null;
    rolesRequested?: number | null;
    agreedRoles?: number | null;
  },
) {
  assertOpen(need.round);
  return prisma.hiringDepartmentNeed.update({
    where: { id: need.id },
    data: { ...input, ...(input.status ? stampsFor(input.status, new Date()) : {}) },
  });
}

export async function needThread(need: { id: string }) {
  const notes = await prisma.hiringNeedNote.findMany({
    where: { needId: need.id },
    orderBy: { createdAt: "asc" },
    take: NOTES_PER_NEED_LIMIT,
    select: { id: true, authorName: true, authorRole: true, body: true, createdAt: true },
  });
  return notes;
}

export async function addNeedNote(
  actor: HiringActor,
  need: { id: string; round: { status: string } },
  body: string,
) {
  assertOpen(need.round);
  const count = await prisma.hiringNeedNote.count({ where: { needId: need.id } });
  if (count >= NOTES_PER_NEED_LIMIT)
    throw new HiringRuleError(
      `A challenge thread holds at most ${NOTES_PER_NEED_LIMIT} notes.`,
      409,
    );
  const roles = await prisma.roleAssignment.findMany({
    where: { userId: actor.userId, role: { deletedAt: null } },
    select: { role: { select: { name: true } } },
    take: 5,
  });
  return prisma.hiringNeedNote.create({
    data: {
      needId: need.id,
      authorId: actor.userId,
      authorName: actor.name,
      authorRole: roles[0]?.role.name ?? null,
      body,
    },
  });
}
