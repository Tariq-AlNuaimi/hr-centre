import { prisma } from "@/lib/prisma";
import { OrgRuleError } from "@/lib/org/rules";
import { REFERENCE_SCHEMAS, type ReferenceResource } from "@/lib/validations/hive/reference";
import type { z } from "zod";

/**
 * HR tickets' reference data — CRUD for the screens HIVE never had (US-H9).
 * Gated on `tickets.configure` by the routes. Every write goes through the
 * audited client; deletes are soft (the extension stamps `deletedAt`, and the
 * recycling bin can restore them). Lists are bounded.
 *
 * The three structures stay independent (HIVE §4.4): HR Tag coverage and
 * rotation coverage own their own labels and aliases, and their links to core
 * org units are optional soft links that never rename anything.
 *
 * @public
 */

type Input<R extends ReferenceResource> = z.output<(typeof REFERENCE_SCHEMAS)[R]>;

/** Rows per page of the provider list (≈464 rows); every other list is small. */
export const PROVIDER_PAGE = 50;

const COVERAGE_SELECT = {
  id: true,
  pairId: true,
  label: true,
  aliases: true,
  entityId: true,
  companyWide: true,
  directorateId: true,
  departmentId: true,
} as const;

export async function listReference(resource: ReferenceResource, q?: string, page = 1) {
  switch (resource) {
    case "pairs":
      return prisma.hrTagPair.findMany({
        orderBy: [{ order: "asc" }, { name: "asc" }],
        select: { id: true, name: true, order: true, isDefault: true },
        take: 100,
      });
    case "members":
      return prisma.hrTagMember.findMany({
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          pairId: true,
          name: true,
          email: true,
          phone: true,
          order: true,
          user: { select: { id: true, name: true, email: true } },
        },
        take: 200,
      });
    case "coverage":
      return prisma.hrTagCoverage.findMany({
        orderBy: { label: "asc" },
        select: COVERAGE_SELECT,
        take: 200,
      });
    case "rotation-groups":
      return prisma.rotationGroup.findMany({
        orderBy: [{ order: "asc" }, { name: "asc" }],
        select: { id: true, name: true, mode: true, order: true },
        take: 50,
      });
    case "rotation-coverage":
      return prisma.rotationCoverage.findMany({
        orderBy: { label: "asc" },
        select: {
          id: true,
          groupId: true,
          label: true,
          aliases: true,
          entityId: true,
          directorateId: true,
          departmentId: true,
        },
        take: 200,
      });
    case "discounts":
      return prisma.discountPartner.findMany({
        orderBy: [{ order: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          offerSummary: true,
          eligibility: true,
          validUntil: true,
          redemption: true,
          onlineOnly: true,
          url: true,
          order: true,
        },
        take: 200,
      });
    case "providers": {
      const where = q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { location: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {};
      const [rows, total] = await Promise.all([
        prisma.networkProvider.findMany({
          where,
          orderBy: [{ name: "asc" }, { location: "asc" }],
          select: {
            id: true,
            name: true,
            providerType: true,
            location: true,
            address: true,
            phone: true,
          },
          skip: (page - 1) * PROVIDER_PAGE,
          take: PROVIDER_PAGE,
        }),
        prisma.networkProvider.count({ where }),
      ]);
      return { rows, total, page, pageSize: PROVIDER_PAGE };
    }
  }
}

async function assertPairExists(pairId: string) {
  const pair = await prisma.hrTagPair.findFirst({ where: { id: pairId }, select: { id: true } });
  if (!pair) throw new OrgRuleError("pairId: that HR pair does not exist", 400);
}

async function assertGroupExists(groupId: string) {
  const group = await prisma.rotationGroup.findFirst({
    where: { id: groupId },
    select: { id: true },
  });
  if (!group) throw new OrgRuleError("groupId: that rotation group does not exist", 400);
}

/** Optional company / unit soft links must point at live core units. */
async function assertOrgLinks(v: {
  entityId: string | null;
  directorateId: string | null;
  departmentId: string | null;
}) {
  const [entity, directorate, department] = await Promise.all([
    v.entityId
      ? prisma.orgEntity.findFirst({ where: { id: v.entityId }, select: { id: true } })
      : null,
    v.directorateId
      ? prisma.directorate.findFirst({ where: { id: v.directorateId }, select: { entityId: true } })
      : null,
    v.departmentId
      ? prisma.department.findFirst({ where: { id: v.departmentId }, select: { entityId: true } })
      : null,
  ]);
  if (v.entityId && !entity) throw new OrgRuleError("entityId: that company does not exist", 400);
  if (v.directorateId && !directorate)
    throw new OrgRuleError("directorateId: that directorate does not exist", 400);
  if (v.departmentId && !department)
    throw new OrgRuleError("departmentId: that department does not exist", 400);
  const unitCompany = directorate?.entityId ?? department?.entityId ?? null;
  if (v.entityId && unitCompany && unitCompany !== v.entityId) {
    throw new OrgRuleError("The linked unit belongs to a different company", 400);
  }
}

/**
 * The HR Centre login this member signs in with — the account whose email is
 * the member's, when one exists and no other live member holds it. This link
 * defines the person's OWN_HR_PAIR scope (ADR-079), so it is derived from the
 * email, never typed: changing access stays a platform admin's role-builder
 * decision, and HR editing a pair's contact card cannot quietly grant it.
 */
async function loginFor(email: string, exceptMemberId?: string): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, hiveTagMember: { select: { id: true } } },
  });
  if (!user) return null;
  if (user.hiveTagMember && user.hiveTagMember.id !== exceptMemberId) return null;
  return user.id;
}

async function assertMemberEmailFree(email: string, exceptId?: string) {
  const clash = await prisma.hrTagMember.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new OrgRuleError("email: this person is already a member of a pair", 409);
}

/** The slice of a Prisma delegate this module uses (one shape for every list). */
type Delegate = {
  findFirst(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>;
  create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
    select: { id: true };
  }): Promise<{ id: string }>;
  delete(args: { where: { id: string } }): Promise<unknown>;
};

/**
 * Per list: its delegate, and what to check / derive before a write. One
 * registry instead of a switch per verb (the write rules live in `prepare`).
 */
const WRITERS: Record<
  ReferenceResource,
  {
    delegate: () => Delegate;
    prepare?: (input: Record<string, unknown>, id?: string) => Promise<Record<string, unknown>>;
  }
> = {
  pairs: { delegate: () => prisma.hrTagPair as unknown as Delegate },
  members: {
    delegate: () => prisma.hrTagMember as unknown as Delegate,
    prepare: async (m, id) => {
      const member = m as Input<"members">;
      await assertPairExists(member.pairId);
      await assertMemberEmailFree(member.email, id);
      return { ...member, userId: await loginFor(member.email, id) };
    },
  },
  coverage: {
    delegate: () => prisma.hrTagCoverage as unknown as Delegate,
    prepare: async (c) => {
      const row = c as Input<"coverage">;
      await assertPairExists(row.pairId);
      await assertOrgLinks(row);
      return row;
    },
  },
  "rotation-groups": { delegate: () => prisma.rotationGroup as unknown as Delegate },
  "rotation-coverage": {
    delegate: () => prisma.rotationCoverage as unknown as Delegate,
    prepare: async (c) => {
      const row = c as Input<"rotation-coverage">;
      await assertGroupExists(row.groupId);
      await assertOrgLinks(row);
      return row;
    },
  },
  discounts: { delegate: () => prisma.discountPartner as unknown as Delegate },
  providers: { delegate: () => prisma.networkProvider as unknown as Delegate },
};

const SELECT_ID = { id: true } as const;

function missing(): never {
  throw new OrgRuleError("Not found", 404);
}

export async function createReference<R extends ReferenceResource>(resource: R, input: Input<R>) {
  const w = WRITERS[resource];
  const data = w.prepare ? await w.prepare(input) : (input as Record<string, unknown>);
  return w.delegate().create({ data, select: SELECT_ID });
}

export async function updateReference<R extends ReferenceResource>(
  resource: R,
  id: string,
  input: Input<R>,
) {
  const w = WRITERS[resource];
  if (!(await w.delegate().findFirst({ where: { id }, select: SELECT_ID }))) missing();
  const data = w.prepare ? await w.prepare(input, id) : (input as Record<string, unknown>);
  return w.delegate().update({ where: { id }, data, select: SELECT_ID });
}

/** Soft delete (the extension stamps `deletedAt`; restorable from the recycling bin). */
export async function removeReference(resource: ReferenceResource, id: string) {
  const delegate = WRITERS[resource].delegate();
  if (!(await delegate.findFirst({ where: { id }, select: SELECT_ID }))) missing();
  // A removed member must stop defining anyone's own pair at once.
  if (resource === "members") {
    await delegate.update({ where: { id }, data: { userId: null }, select: SELECT_ID });
  }
  await delegate.delete({ where: { id } });
}
