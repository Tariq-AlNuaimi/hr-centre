import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { RoleProfileStatus } from "@/generated/prisma/client";
import type {
  CreateRoleProfile,
  UpdateRoleProfile,
  CompetencyValue,
  SjtItemValue,
} from "@/lib/validations/roleProfile";

// Service layer for role-profile authoring (CLAUDE.md "UI → API route → service →
// Prisma"). Owns the non-trivial bits the routes shouldn't: nested child writes,
// versioning/lineage, and the approve→supersede transition.
//
// AUDIT DESIGN: the audit extension hooks top-level model ops, so a RoleProfile
// create/update/delete/approve is auto-audited (actor, action, timestamp, orgId).
// Competencies/facets/SJTs are written as ATOMIC nested relation writes within the
// parent op (one query, no bulk-method call → no `no-unaudited-bulk-write` trip,
// no transaction-in-extension hazard). Full *content* history is preserved by the
// immutable versioning (an APPROVED/ACTIVE version is never mutated; revising
// clones a new version), so "who changed what" (audit_logs) + "what each version
// contained" (the version rows) together form the complete PDPL trail.

// Statuses whose content may still be edited. APPROVED/ACTIVE/ARCHIVED are frozen.
const EDITABLE_STATUSES: RoleProfileStatus[] = [
  RoleProfileStatus.DRAFT,
  RoleProfileStatus.IN_REVIEW,
];

export function isEditable(status: RoleProfileStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

// Full detail shape (UI-SPEC D.4): competencies + their facets + SJT items, ordered.
export const roleProfileDetailInclude = {
  roleFamily: { select: { id: true, key: true, name: true } },
  competencies: {
    orderBy: { order: "asc" },
    include: { facets: { select: { facet: true } } },
  },
  sjtItems: { orderBy: { order: "asc" } },
} satisfies Prisma.RoleProfileInclude;

export type RoleProfileDetail = Prisma.RoleProfileGetPayload<{
  include: typeof roleProfileDetailInclude;
}>;

// Translate validated competency input into nested-create data (with facets).
function competencyCreateData(
  comps: CompetencyValue[]
): Prisma.CompetencyCreateWithoutRoleProfileInput[] {
  return comps.map((c, i) => ({
    name: c.name,
    onetRef: c.onetRef ?? null,
    importance: c.importance ?? null,
    weight: c.weight,
    direction: c.direction,
    targetPercentile: c.targetPercentile,
    sourceCitation: c.sourceCitation ?? null,
    order: i,
    facets: { create: c.facets.map((facet) => ({ facet })) },
  }));
}

function sjtCreateData(
  items: SjtItemValue[]
): Prisma.SjtItemCreateWithoutRoleProfileInput[] {
  return items.map((s, i) => ({
    scenario_en: s.scenario_en,
    scenario_ar: s.scenario_ar ?? null,
    // Validated JSON shapes; stored verbatim (cast through Prisma's JSON input).
    options: s.options as unknown as Prisma.InputJsonValue,
    scoringKey: s.scoringKey as unknown as Prisma.InputJsonValue,
    order: i,
  }));
}

export type ListFilters = {
  skip: number;
  take: number;
  status?: RoleProfileStatus;
  roleFamilyId?: string;
  search?: string;
};

/** Tenant-scoped, bounded list for the role-profiles table (UI-SPEC D.2). */
export async function listRoleProfiles(orgId: string, filters: ListFilters) {
  const where: Prisma.RoleProfileWhereInput = {
    orgId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.roleFamilyId ? { roleFamilyId: filters.roleFamilyId } : {}),
    ...(filters.search
      ? { title: { contains: filters.search, mode: "insensitive" as const } }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.roleProfile.findMany({
      where,
      skip: filters.skip,
      take: filters.take,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        version: true,
        status: true,
        isAiDrafted: true,
        updatedAt: true,
        roleFamily: { select: { id: true, key: true, name: true } },
        _count: { select: { competencies: true, sjtItems: true } },
      },
    }),
    prisma.roleProfile.count({ where }),
  ]);

  return { data, total };
}

/** Full detail, tenant-scoped (404 on cross-tenant id → no existence leak). */
export function getRoleProfile(
  orgId: string,
  id: string
): Promise<RoleProfileDetail | null> {
  return prisma.roleProfile.findFirst({
    where: { id, orgId },
    include: roleProfileDetailInclude,
  });
}

/** Create a new DRAFT (version 1 of a fresh lineage). */
export function createRoleProfile(
  orgId: string,
  userId: string,
  input: CreateRoleProfile
): Promise<RoleProfileDetail> {
  return prisma.roleProfile.create({
    data: {
      orgId,
      roleFamilyId: input.roleFamilyId,
      // A fresh lineage id groups every future version of this profile.
      lineageId: randomUUID(),
      version: 1,
      status: RoleProfileStatus.DRAFT,
      title: input.title,
      jdSourceText: input.jdSourceText ?? null,
      isAiDrafted: input.isAiDrafted,
      createdById: userId,
      competencies: { create: competencyCreateData(input.competencies) },
      sjtItems: { create: sjtCreateData(input.sjtItems) },
    },
    include: roleProfileDetailInclude,
  });
}

/**
 * Replace an editable DRAFT/IN_REVIEW profile's content. Children are replaced via
 * atomic nested deleteMany+create (these children aren't soft-deletable, so a hard
 * replace is correct). Only provided sections are touched.
 */
export function updateRoleProfile(
  id: string,
  input: UpdateRoleProfile
): Promise<RoleProfileDetail> {
  const data: Prisma.RoleProfileUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.jdSourceText !== undefined) data.jdSourceText = input.jdSourceText ?? null;
  if (input.status !== undefined) data.status = input.status;
  if (input.competencies !== undefined) {
    data.competencies = { deleteMany: {}, create: competencyCreateData(input.competencies) };
  }
  if (input.sjtItems !== undefined) {
    data.sjtItems = { deleteMany: {}, create: sjtCreateData(input.sjtItems) };
  }

  return prisma.roleProfile.update({
    where: { id },
    data,
    include: roleProfileDetailInclude,
  });
}

/**
 * Clone a profile into a new DRAFT version of the SAME lineage (version = max+1).
 * The source (an immutable APPROVED/ACTIVE version) is never mutated — this is the
 * "clone to edit" path that keeps historical results interpretable (ARCHITECTURE §5).
 */
export async function cloneNewVersion(
  source: RoleProfileDetail,
  userId: string
): Promise<RoleProfileDetail> {
  // Highest existing version in this lineage (within the org) → +1.
  const latest = await prisma.roleProfile.findFirst({
    where: { orgId: source.orgId, lineageId: source.lineageId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? source.version) + 1;

  return prisma.roleProfile.create({
    data: {
      orgId: source.orgId,
      roleFamilyId: source.roleFamilyId,
      lineageId: source.lineageId,
      version: nextVersion,
      status: RoleProfileStatus.DRAFT,
      title: source.title,
      jdSourceText: source.jdSourceText,
      isAiDrafted: source.isAiDrafted,
      createdById: userId,
      competencies: {
        create: source.competencies.map((c, i) => ({
          name: c.name,
          onetRef: c.onetRef,
          importance: c.importance,
          weight: c.weight,
          direction: c.direction,
          targetPercentile: c.targetPercentile,
          sourceCitation: c.sourceCitation,
          order: i,
          facets: { create: c.facets.map((f) => ({ facet: f.facet })) },
        })),
      },
      sjtItems: {
        create: source.sjtItems.map((s, i) => ({
          scenario_en: s.scenario_en,
          scenario_ar: s.scenario_ar,
          options: s.options as Prisma.InputJsonValue,
          scoringKey: s.scoringKey as Prisma.InputJsonValue,
          order: i,
        })),
      },
    },
    include: roleProfileDetailInclude,
  });
}

/**
 * Approve & activate a profile (UI-SPEC D.3 step 5). Records approver + timestamp,
 * sets status ACTIVE, and ARCHIVEs the prior ACTIVE version of the same lineage so
 * exactly one version is ACTIVE. The lineage invariant means there is at most one
 * prior ACTIVE → a single update, never a bulk write.
 */
export async function approveRoleProfile(
  profile: RoleProfileDetail,
  userId: string
): Promise<RoleProfileDetail> {
  const priorActive = await prisma.roleProfile.findFirst({
    where: {
      orgId: profile.orgId,
      lineageId: profile.lineageId,
      status: RoleProfileStatus.ACTIVE,
      id: { not: profile.id },
    },
    select: { id: true },
  });
  if (priorActive) {
    await prisma.roleProfile.update({
      where: { id: priorActive.id },
      data: { status: RoleProfileStatus.ARCHIVED },
    });
  }

  return prisma.roleProfile.update({
    where: { id: profile.id },
    data: {
      status: RoleProfileStatus.ACTIVE,
      approvedById: userId,
      approvedAt: new Date(),
    },
    include: roleProfileDetailInclude,
  });
}

/** Full version history of a lineage (UI-SPEC D.4 timeline), tenant-scoped. */
export function listVersions(orgId: string, lineageId: string) {
  return prisma.roleProfile.findMany({
    where: { orgId, lineageId },
    orderBy: { version: "desc" },
    // Bound the timeline (Pillar 4: Scalable). A lineage accrues versions slowly;
    // 200 is far above any realistic revision count, newest-first.
    take: 200,
    select: {
      id: true,
      version: true,
      status: true,
      isAiDrafted: true,
      createdById: true,
      approvedById: true,
      approvedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Strip every SJT scoringKey unless the viewer is an admin (UI-SPEC D.4: keys are
 * masked for non-admins server-side, never sent to a manager or candidate).
 */
export function maskScoringKeys(
  profile: RoleProfileDetail,
  isAdmin: boolean
): RoleProfileDetail {
  if (isAdmin) return profile;
  return {
    ...profile,
    sjtItems: profile.sjtItems.map((s) => ({ ...s, scoringKey: null })),
  };
}
