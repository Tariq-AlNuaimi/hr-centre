import { unstable_cache } from "next/cache";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { PRIVACY_NOTICE_VERSION, type ApplyInput } from "@/lib/validations/hiring/public";
import { HiringRuleError } from "./http";
import { CAREERS_TAG } from "./jd";
import { orgNames } from "./people";
import { asNumber, readSetting } from "./settings";

/**
 * The public careers board and its apply path (Interview Hub `/careers`,
 * `/api/careers`, `/api/careers/apply`). A role is on the board only when it is
 * OPEN, its JD is signed, and a careers posting is LIVE. Nothing about pay
 * leaves this module — the band stays internal.
 */

const BOARD_CAP = 100;

export type CareersRole = {
  id: string;
  title: string;
  company: string;
  department: string;
  description: string;
  postedAt: string | null;
};

/** The board, cached 60 s and revalidated on the careers tag (posting / JD changes). */
export const listOpenRoles = unstable_cache(
  async (): Promise<CareersRole[]> => {
    const rows = await prisma.hiringRequisition.findMany({
      where: {
        status: "OPEN",
        deletedAt: null,
        jdApprovedAt: { not: null },
        postings: { some: { channel: "CAREERS_PAGE", state: "LIVE" } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: BOARD_CAP,
      select: {
        id: true,
        title: true,
        entityId: true,
        departmentId: true,
        description: true,
        postings: {
          where: { channel: "CAREERS_PAGE", state: "LIVE" },
          select: { postedAt: true },
          take: 1,
        },
      },
    });
    const org = await orgNames(
      rows.map((r) => r.entityId),
      rows.flatMap((r) => (r.departmentId ? [r.departmentId] : [])),
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      company: org.entities.get(r.entityId)?.name ?? "",
      department: r.departmentId ? (org.departments.get(r.departmentId) ?? "") : "",
      description: r.description,
      postedAt: r.postings[0]?.postedAt?.toISOString() ?? null,
    }));
  },
  ["hiring-careers-board"],
  { revalidate: 60, tags: [CAREERS_TAG] },
);

/** Is this requisition on the board right now (uncached — the apply path must be exact)? */
export async function advertisedRequisition(id: string) {
  return prisma.hiringRequisition.findFirst({
    where: {
      id,
      status: "OPEN",
      deletedAt: null,
      jdApprovedAt: { not: null },
      postings: { some: { channel: "CAREERS_PAGE", state: "LIVE" } },
    },
    select: { id: true, title: true },
  });
}

/**
 * Duplicate check, case-insensitive (D18 — Interview Hub compared case-
 * sensitively, so "A@x.com" and "a@x.com" were two applications).
 */
export async function alreadyApplied(
  email: string,
  requisitionId: string | null,
): Promise<boolean> {
  if (!requisitionId) return false;
  const found = await prisma.hiringCandidate.findFirst({
    where: { requisitionId, email: { equals: email, mode: "insensitive" }, erasedAt: null },
    select: { id: true },
  });
  return found !== null;
}

const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

export async function applyToRole(input: ApplyInput) {
  const req = await advertisedRequisition(input.requisitionId);
  if (!req) throw new HiringRuleError("This role is no longer open for applications.", 404);
  const cap = asNumber(await readSetting("careers.dailyCapPerPosition"), 0);
  if (cap > 0) {
    const today = await prisma.hiringCandidate.count({
      where: { requisitionId: req.id, source: "CAREERS_PAGE", createdAt: { gte: startOfUtcDay() } },
    });
    if (today >= cap) {
      throw new HiringRuleError(
        "This role has reached today's application limit. Please try again tomorrow.",
        429,
      );
    }
  }
  const email = input.email.trim().toLowerCase();
  if (await alreadyApplied(email, req.id)) {
    throw new HiringRuleError("You have already applied for this role.", 409, "ALREADY_APPLIED");
  }
  await auditedTransaction(async (tx) => {
    await tx.hiringCandidate.create({
      data: {
        requisitionId: req.id,
        name: input.name,
        email,
        phone: input.phone || null,
        nationality: input.nationality || null,
        currentEmployer: input.currentEmployer || null,
        linkedinUrl: input.linkedinUrl || null,
        source: "CAREERS_PAGE",
        stage: "NEW_APPLICATION",
        consentAt: new Date(),
        noticeVersion: PRIVACY_NOTICE_VERSION,
      },
      select: { id: true },
    });
  });
  return { applied: true };
}
