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
  // Find this candidate's invitations in the org, with their assessment + result +
  // outcome ids.
  const invitations = await prisma.invitation.findMany({
    where: { orgId, candidateEmail: email },
    select: {
      id: true,
      assessment: {
        select: { id: true, result: { select: { id: true, outcome: { select: { id: true } } } } },
      },
    },
  });
  if (invitations.length === 0) return { kind: "not-found" };

  for (const inv of invitations) {
    // Children first so each soft-delete is independently audited and nothing is
    // stranded. OutcomeRecord → Result → Assessment → Invitation. The OutcomeRecord
    // is soft-deleted EXPLICITLY: it has its own deletedAt + recycling registration,
    // and the Result soft-delete does NOT cascade to it (the FK cascade only fires on
    // a HARD delete) — without this it would survive the erasure and be restorable
    // (senior-review MED-2, a PDPL completeness gap).
    const result = inv.assessment?.result;
    if (result?.outcome) await prisma.outcomeRecord.delete({ where: { id: result.outcome.id } });
    if (result) await prisma.result.delete({ where: { id: result.id } });
    if (inv.assessment) await prisma.assessment.delete({ where: { id: inv.assessment.id } });
    await prisma.invitation.delete({ where: { id: inv.id } });
  }
  return { kind: "ok", sittings: invitations.length };
}
