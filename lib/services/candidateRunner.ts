import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  InvitationStatus,
  AssessmentStatus,
} from "@/generated/prisma/client";

// Service layer for the candidate runner (ARCHITECTURE §8/§12.4, UI-SPEC C.1–C.4).
// The candidate has NO account: an opaque high-entropy token (Invitation.token)
// authorizes every read/write, and the resolved orgId is stamped with a NULL user
// (the candidate is not a User). SJT scoring keys NEVER cross to the client.

// ---- Token state (UI-SPEC C.1: valid / expired / completed / invalid) ----

export type TokenState =
  | "invalid" // unknown / soft-deleted (erased) token — generic, no enumeration
  | "revoked" // invitation revoked by HR (Phase 5)
  | "expired" // past expiresAt
  | "completed" // already submitted — no re-take
  | "active"; // open for consent / answering

export type ResolvedInvitation = Prisma.InvitationGetPayload<{
  include: { assessment: true };
}>;

export type TokenResolution =
  | { state: "invalid" }
  | {
      state: Exclude<TokenState, "invalid">;
      invitation: ResolvedInvitation;
    };

/**
 * Resolve a candidate token to its state + invitation (UI-SPEC C.1). Uses the
 * filtered client so a soft-deleted (erased) invitation resolves to `invalid` —
 * an erased candidate's link stops working. The token is high-entropy, so a direct
 * unique lookup is safe; missing/erased both return the same generic `invalid` so
 * the surface can't be enumerated.
 */
export async function resolveToken(token: string): Promise<TokenResolution> {
  if (!token || token.length < 16) return { state: "invalid" };

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { assessment: true },
  });
  if (!invitation) return { state: "invalid" };

  if (invitation.status === InvitationStatus.REVOKED) {
    return { state: "revoked", invitation };
  }
  if (
    invitation.status === InvitationStatus.COMPLETED ||
    invitation.assessment?.status === AssessmentStatus.SUBMITTED
  ) {
    return { state: "completed", invitation };
  }
  if (invitation.expiresAt && invitation.expiresAt.getTime() < Date.now()) {
    return { state: "expired", invitation };
  }
  return { state: "active", invitation };
}

/**
 * Read-only display strings for the candidate runner header (UI-SPEC C.1): the
 * role title + org name for branding context. Bounded single-row lookups; the
 * scoringKey and any other non-display field are never selected. Used by the RSC
 * page to brand the active flow — never reaches a write path.
 */
export async function getInvitationDisplay(
  invitationId: string,
  orgId: string
): Promise<{ roleTitle: string; orgName: string } | null> {
  // orgId-scoped (defensive tenancy): an unscoped findUnique({where:{id}}) is a
  // cross-tenant disclosure class (SECURITY.md §3) — scope even when the id is
  // token-derived today, so a future caller can't cross orgs.
  const inv = await prisma.invitation.findFirst({
    where: { id: invitationId, orgId },
    select: {
      roleProfile: { select: { title: true } },
      org: { select: { name: true } },
    },
  });
  if (!inv) return null;
  return { roleTitle: inv.roleProfile.title, orgName: inv.org.name };
}

// ---- Bilingual render payload (UI-SPEC C.2/C.3/C.5) ----
//
// Items/SJT carry BOTH languages so the client runner can switch EN/AR in place
// without re-fetching or losing progress (C.5). The client picks ar ?? en for AR.
// scoringKey is NEVER selected — it must not reach the client.

export type BilingualItem = {
  itemNumber: number;
  text_en: string;
  text_ar: string | null;
};
export type BilingualSjtOption = { id: string; text_en: string; text_ar: string | null };
export type BilingualSjtItem = {
  id: string;
  scenario_en: string;
  scenario_ar: string | null;
  options: BilingualSjtOption[];
};

/** The fixed 120 IPIP items (both languages), render order. */
export async function getBilingualItems(): Promise<BilingualItem[]> {
  return prisma.assessmentItemBank.findMany({
    orderBy: { itemNumber: "asc" },
    take: 120, // the instrument is fixed at 120 (Pillar 4: bounded)
    select: { itemNumber: true, text_en: true, text_ar: true },
  });
}

/**
 * The role's SJT items for the candidate (both languages), with scoringKey OMITTED
 * at the query level (never sent client-side, UI-SPEC C.3).
 */
export async function getBilingualSjtItems(
  roleProfileId: string
): Promise<BilingualSjtItem[]> {
  const items = await prisma.sjtItem.findMany({
    where: { roleProfileId },
    orderBy: { order: "asc" },
    take: 100, // bounded (Pillar 4); a role has a handful of scenarios
    // NB: scoringKey is intentionally NOT selected — it must never reach the client.
    select: {
      id: true,
      scenario_en: true,
      scenario_ar: true,
      options: true,
    },
  });
  return items.map((it) => {
    const opts = Array.isArray(it.options)
      ? (it.options as Array<{ id: string; text_en: string; text_ar: string | null }>)
      : [];
    return {
      id: it.id,
      scenario_en: it.scenario_en,
      scenario_ar: it.scenario_ar,
      options: opts.map((o) => ({ id: o.id, text_en: o.text_en, text_ar: o.text_ar ?? null })),
    };
  });
}

/** A candidate's saved answers, for resume (UI-SPEC C.2 "resume to first unanswered"). */
export async function getSavedResponses(assessmentId: string, orgId: string) {
  // Scope through the assessment's orgId (defensive tenancy; see getInvitationDisplay).
  const [items, sjt] = await Promise.all([
    prisma.itemResponse.findMany({
      where: { assessmentId, assessment: { orgId } },
      take: 120,
      select: { itemNumber: true, value: true },
    }),
    prisma.sjtResponse.findMany({
      where: { assessmentId, assessment: { orgId } },
      take: 100,
      select: { sjtItemId: true, chosenOptionId: true },
    }),
  ]);
  return { items, sjt };
}

// ---- Writes (token-authorized; audited via create/update, never upsert) ----

/**
 * Record PDPL consent and open the sitting (UI-SPEC C.1). Idempotent: a second
 * consent POST returns the existing assessment (the candidate may reload). Creates
 * the Assessment (CONSENTED + consentAt) and flips the invitation PENDING/OPENED →
 * STARTED. consentAt is captured BEFORE any item response is accepted.
 */
export async function recordConsent(
  invitation: ResolvedInvitation,
  locale: string
): Promise<{ id: string; locale: string }> {
  if (invitation.assessment) {
    return { id: invitation.assessment.id, locale: invitation.assessment.locale };
  }
  let assessment: { id: string; locale: string };
  try {
    assessment = await prisma.assessment.create({
      data: {
        orgId: invitation.orgId,
        invitationId: invitation.id,
        status: AssessmentStatus.CONSENTED,
        locale,
        consentAt: new Date(),
      },
      select: { id: true, locale: true },
    });
  } catch (e) {
    // Two concurrent consent POSTs (mobile double-tap) both read assessment=null
    // and race into create; the loser hits @@unique([invitationId]) (P2002). The
    // op is idempotent — return the winner's row instead of 500-ing the candidate.
    if (!isUniqueViolation(e)) throw e;
    const existing = await prisma.assessment.findUnique({
      where: { invitationId: invitation.id },
      select: { id: true, locale: true },
    });
    if (!existing) throw e;
    return existing;
  }
  // Move the invitation forward (PENDING/OPENED → STARTED). Audited.
  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { status: InvitationStatus.STARTED },
  });
  return assessment;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** On the first saved answer, mark the sitting IN_PROGRESS (startedAt). */
async function ensureInProgress(assessment: { id: string; status: AssessmentStatus }) {
  if (assessment.status === AssessmentStatus.CONSENTED) {
    await prisma.assessment.update({
      where: { id: assessment.id },
      data: { status: AssessmentStatus.IN_PROGRESS, startedAt: new Date() },
    });
  }
}

/**
 * Idempotent autosave of one IPIP answer (UI-SPEC C.2). find-then-create/update
 * (NOT upsert) so the audit extension captures it (no-unaudited-bulk-write).
 * A no-op when the value is unchanged (avoids audit churn). Races on the unique
 * (assessmentId,itemNumber) fall back to update.
 */
export async function saveItemResponse(
  assessment: { id: string; status: AssessmentStatus },
  itemNumber: number,
  value: number
): Promise<void> {
  await ensureInProgress(assessment);
  const existing = await prisma.itemResponse.findUnique({
    where: { assessmentId_itemNumber: { assessmentId: assessment.id, itemNumber } },
    select: { id: true, value: true },
  });
  if (existing) {
    if (existing.value !== value) {
      await prisma.itemResponse.update({ where: { id: existing.id }, data: { value } });
    }
    return;
  }
  try {
    await prisma.itemResponse.create({
      data: { assessmentId: assessment.id, itemNumber, value },
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    await prisma.itemResponse.update({
      where: { assessmentId_itemNumber: { assessmentId: assessment.id, itemNumber } },
      data: { value },
    });
  }
}

/**
 * Idempotent autosave of one SJT answer (UI-SPEC C.3). Verifies the item belongs
 * to the invitation's role profile AND the chosen option id is one of that item's
 * options (the key is never consulted client-side). Returns false on a bad
 * item/option (→ 422), true on save.
 */
export async function saveSjtResponse(
  assessment: { id: string; status: AssessmentStatus },
  roleProfileId: string,
  sjtItemId: string,
  chosenOptionId: string
): Promise<boolean> {
  const item = await prisma.sjtItem.findFirst({
    where: { id: sjtItemId, roleProfileId },
    select: { id: true, options: true },
  });
  if (!item) return false;
  const optionIds = Array.isArray(item.options)
    ? (item.options as Array<{ id: string }>).map((o) => o.id)
    : [];
  if (!optionIds.includes(chosenOptionId)) return false;

  await ensureInProgress(assessment);
  const existing = await prisma.sjtResponse.findUnique({
    where: { assessmentId_sjtItemId: { assessmentId: assessment.id, sjtItemId } },
    select: { id: true, chosenOptionId: true },
  });
  if (existing) {
    if (existing.chosenOptionId !== chosenOptionId) {
      await prisma.sjtResponse.update({
        where: { id: existing.id },
        data: { chosenOptionId },
      });
    }
    return true;
  }
  try {
    await prisma.sjtResponse.create({
      data: { assessmentId: assessment.id, sjtItemId, chosenOptionId },
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    await prisma.sjtResponse.update({
      where: { assessmentId_sjtItemId: { assessmentId: assessment.id, sjtItemId } },
      data: { chosenOptionId },
    });
  }
  return true;
}

/**
 * Submit the sitting (UI-SPEC C.4). Marks the Assessment SUBMITTED + submittedAt
 * and the Invitation COMPLETED. Result/scoring roll-up is Phase 6.
 */
export async function submitAssessment(assessment: {
  id: string;
  invitationId: string;
}): Promise<void> {
  await prisma.assessment.update({
    where: { id: assessment.id },
    data: { status: AssessmentStatus.SUBMITTED, submittedAt: new Date() },
  });
  await prisma.invitation.update({
    where: { id: assessment.invitationId },
    data: { status: InvitationStatus.COMPLETED },
  });
}
