import { prisma } from "@/lib/prisma";

// PDPL right-to-erasure (ARCHITECTURE §11, UI-SPEC D.10). Given a candidate email,
// soft-deletes their sitting — the Invitation AND its Assessment AND any computed
// Result — so the candidate's data disappears from every list immediately and is
// queued for the recycling-bin purge (which then HARD-deletes; the Invitation's
// onDelete cascade removes the assessment + responses for a full erasure). All
// soft-deletes go through the AUDITED `prisma` client (per-row delete, never bulk),
// so the erasure is recorded in the audit trail. Tenant-scoped.

export type EraseResult = { kind: "ok"; sittings: number } | { kind: "not-found" };

export async function eraseCandidate(orgId: string, email: string): Promise<EraseResult> {
  // Find this candidate's invitations in the org, with their assessment + result ids.
  const invitations = await prisma.invitation.findMany({
    where: { orgId, candidateEmail: email },
    select: {
      id: true,
      assessment: { select: { id: true, result: { select: { id: true } } } },
    },
  });
  if (invitations.length === 0) return { kind: "not-found" };

  for (const inv of invitations) {
    // Children first so each soft-delete is independently audited and nothing is
    // stranded if a later step were to fail. Result → Assessment → Invitation.
    const resultId = inv.assessment?.result?.id;
    if (resultId) await prisma.result.delete({ where: { id: resultId } });
    if (inv.assessment) await prisma.assessment.delete({ where: { id: inv.assessment.id } });
    await prisma.invitation.delete({ where: { id: inv.id } });
  }
  return { kind: "ok", sittings: invitations.length };
}
