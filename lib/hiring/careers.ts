import { unstable_cache } from "next/cache";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { PRIVACY_NOTICE_VERSION, type ApplyInput } from "@/lib/validations/hiring/public";
import { HiringRuleError } from "./http";
import { placeLabel, roleSlug, type JobLocation } from "./careers-jd";
import { CAREERS_TAG } from "./jd";
import { orgNames } from "./people";
import { asNumber, readSetting } from "./settings";
import { emailApplicationReceived, issueCandidateStatusLink } from "./candidate-status";

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
  slug: string;
  location: JobLocation;
  /** "Muscat, Oman" — what the board's location filter groups by. */
  place: string;
};

/** One role's page: the board's fields plus the JD as written and its close date. */
export type CareersRoleDetail = CareersRole & {
  descriptionMarkdown: string;
  validThrough: string | null;
};

/**
 * QA D-06 — a JD is written in Markdown, and the board's two-line summary showed
 * it raw ("## About the role … - Design APIs"). The board gets plain text:
 * headings, list markers, emphasis, code ticks and link syntax are dropped and
 * the lines are joined. Pure, so it is tested on its own.
 */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, "")
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/g, "$1$2")
        .replace(/`([^`]+)`/g, "$1")
        .trim(),
    )
    .filter(Boolean)
    .map((line) => (/[.!?:;]$/.test(line) ? line : `${line}.`))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function locationOf(r: {
  locationCity: string;
  locationCountry: string;
  workArrangement: JobLocation["arrangement"];
}): { location: JobLocation; place: string } {
  const location = {
    city: r.locationCity,
    country: r.locationCountry,
    arrangement: r.workArrangement,
  };
  return { location, place: placeLabel(location) };
}

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
        locationCity: true,
        locationCountry: true,
        workArrangement: true,
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
      description: markdownToPlainText(r.description),
      postedAt: r.postings[0]?.postedAt?.toISOString() ?? null,
      slug: roleSlug(r.title, r.id),
      ...locationOf(r),
    }));
  },
  // v2: rows now carry the location — a cached v1 row (no location) must never be served.
  ["hiring-careers-board-v2"],
  { revalidate: 60, tags: [CAREERS_TAG] },
);

/**
 * One advertised role for `/careers/<slug>` (UX review P1-10) — the same rule as
 * the board (OPEN, JD signed, careers posting LIVE), cached per id on the
 * careers tag. Null for anything else, so a draft's existence never shows.
 */
export const openRole = unstable_cache(
  async (id: string): Promise<CareersRoleDetail | null> => {
    const r = await prisma.hiringRequisition.findFirst({
      where: {
        id,
        status: "OPEN",
        deletedAt: null,
        jdApprovedAt: { not: null },
        postings: { some: { channel: "CAREERS_PAGE", state: "LIVE" } },
      },
      select: {
        id: true,
        title: true,
        entityId: true,
        departmentId: true,
        description: true,
        targetCloseDate: true,
        locationCity: true,
        locationCountry: true,
        workArrangement: true,
        postings: {
          where: { channel: "CAREERS_PAGE", state: "LIVE" },
          select: { postedAt: true },
          take: 1,
        },
      },
    });
    if (!r) return null;
    const org = await orgNames([r.entityId], r.departmentId ? [r.departmentId] : []);
    return {
      id: r.id,
      title: r.title,
      company: org.entities.get(r.entityId)?.name ?? "",
      department: r.departmentId ? (org.departments.get(r.departmentId) ?? "") : "",
      description: markdownToPlainText(r.description),
      descriptionMarkdown: r.description,
      postedAt: r.postings[0]?.postedAt?.toISOString() ?? null,
      validThrough: r.targetCloseDate?.toISOString() ?? null,
      slug: roleSlug(r.title, r.id),
      ...locationOf(r),
    };
  },
  ["hiring-careers-role-v2"],
  { revalidate: 60, tags: [CAREERS_TAG] },
);

/** Is this requisition on the board right now (uncached — the apply path must be exact)? */
async function advertisedRequisition(id: string) {
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
  const candidate = await auditedTransaction(async (tx) => {
    return tx.hiringCandidate.create({
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
  // P2-11 — the candidate's status link, shown on the confirmation and emailed
  // when SMTP is configured. A failed email never fails the application.
  const statusPath = await issueCandidateStatusLink(candidate.id);
  await emailApplicationReceived({
    candidateId: candidate.id,
    name: input.name,
    email,
    roleTitle: req.title,
    statusPath,
  }).catch(() => console.warn("[hiring] the application confirmation could not be sent"));
  return { applied: true, statusPath };
}
