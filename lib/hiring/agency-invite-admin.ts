import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { can, type HiringActor } from "./access";
import { generateInviteToken, hashInviteToken, INVITE_SELECT } from "./agency-invites";
import { HiringRuleError } from "./http";
import { peopleById } from "./people";
import { canPost } from "./posting-rules";
import { companyScope, requisitionScopeWhere, requisitionSubject } from "./scope";

/**
 * Agency invites — HR's side (Interview Hub `/api/agency-invites`): the
 * scoped list, creating one (the raw link is returned ONCE), and revoking.
 */

export async function listInvites(actor: HiringActor, q: { page: number; pageSize: number }) {
  const scope = await requisitionScopeWhere(actor, "hiring.manage");
  if (scope === null) return { data: [], total: 0 };
  // Group-wide: every invite. Otherwise invites on requisitions in scope, plus
  // general (talent-pool) invites made for the actor's companies.
  const where: Prisma.HiringAgencyInviteWhereInput =
    Object.keys(scope).length === 0
      ? {}
      : {
          OR: [
            { requisition: { is: scope } },
            { requisitionId: null, entityId: { in: companyIds(actor) } },
          ],
        };
  const [rows, total] = await Promise.all([
    prisma.hiringAgencyInvite.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        ...INVITE_SELECT,
        createdById: true,
        createdAt: true,
        lastUsedAt: true,
        _count: { select: { candidates: true } },
      },
    }),
    prisma.hiringAgencyInvite.count({ where }),
  ]);
  const people = await peopleById(rows.map((r) => r.createdById));
  const now = new Date();
  return {
    total,
    data: rows.map((r) => ({
      id: r.id,
      agencyName: r.agencyName,
      requisition: r.requisition ? { id: r.requisition.id, title: r.requisition.title } : null,
      submissions: r._count.candidates,
      maxSubmissions: r.maxSubmissions,
      expiresAt: r.expiresAt,
      lastUsedAt: r.lastUsedAt,
      createdAt: r.createdAt,
      createdBy: people.get(r.createdById)?.name ?? null,
      status: r.revokedAt
        ? "REVOKED"
        : r.expiresAt <= now
          ? "EXPIRED"
          : r._count.candidates >= r.maxSubmissions
            ? "LIMIT_REACHED"
            : "ACTIVE",
    })),
  };
}

/** Companies the actor manages hiring in by company grant (general invites are company-scoped). */
const companyIds = (actor: HiringActor): string[] => companyScope(actor, "hiring.manage") ?? [];

/** Create: the optional requisition must be postable and in scope. Returns the raw link ONCE. */
export async function createInvite(
  actor: HiringActor,
  body: {
    agencyName: string;
    requisitionId?: string | null;
    expiresInDays: number;
    maxSubmissions: number;
  },
  origin: string,
) {
  let entityId: string | null = null;
  if (body.requisitionId) {
    const req = await prisma.hiringRequisition.findUnique({ where: { id: body.requisitionId } });
    if (!req || !can(actor, "hiring.manage", await requisitionSubject(req)))
      throw new HiringRuleError("That requisition was not found.", 404);
    const gate = canPost(req.status, req.jdApprovedAt);
    if (!gate.ok) throw new HiringRuleError(gate.reason, 422);
    entityId = req.entityId;
  } else if (companyScope(actor, "hiring.manage") !== null) {
    const ids = companyIds(actor);
    if (ids.length !== 1)
      throw new HiringRuleError("Pick the requisition this invite is for.", 422);
    entityId = ids[0];
  }
  const token = generateInviteToken();
  const invite = await prisma.hiringAgencyInvite.create({
    data: {
      tokenHash: hashInviteToken(token),
      agencyName: body.agencyName,
      requisitionId: body.requisitionId ?? null,
      entityId,
      expiresAt: new Date(Date.now() + body.expiresInDays * 86_400_000),
      maxSubmissions: body.maxSubmissions,
      createdById: actor.userId,
    },
    select: { id: true },
  });
  return { id: invite.id, url: `${origin}/agency/${token}` };
}

export async function revokeInvite(actor: HiringActor, id: string) {
  const inv = await prisma.hiringAgencyInvite.findUnique({
    where: { id },
    select: {
      id: true,
      revokedAt: true,
      requisitionId: true,
      entityId: true,
      requisition: { select: { entityId: true, departmentId: true } },
    },
  });
  if (!inv) return null;
  const subject = inv.requisition
    ? await requisitionSubject(inv.requisition)
    : { entityId: inv.entityId, departmentId: null, directorateId: null };
  if (!can(actor, "hiring.manage", subject)) return null;
  if (!inv.revokedAt)
    await prisma.hiringAgencyInvite.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: { id: true },
    });
  return { id, revoked: true };
}
