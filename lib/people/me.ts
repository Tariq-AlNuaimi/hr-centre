import { prisma } from "@/lib/prisma";

/**
 * P2 (UX R22) — the employee "Me" area, ready for SSO: what an ordinary
 * employee sees about THEMSELVES. Every read here is keyed on the caller's own
 * employee id (and their own login email for tickets raised before the record
 * was linked) — there is no id parameter anywhere, so there is nothing to
 * scope-check and nothing to guess.
 */

const REQUEST_CAP = 50;

/** Employee-facing ticket states: HR's internal workflow collapsed to three words. */
export type MyRequestState = "WITH_HR" | "ANSWERED" | "CLOSED";

export function myRequestState(status: string): MyRequestState {
  if (status === "SENT") return "ANSWERED";
  if (status === "CLOSED") return "CLOSED";
  return "WITH_HR";
}

/** My HR requests (tickets): my question, its state and when it was answered. */
export async function myRequests(employeeId: string, loginEmail: string | null) {
  const rows = await prisma.escalation.findMany({
    where: {
      OR: [
        { employeeId },
        ...(loginEmail ? [{ employeeId: null, employeeEmail: loginEmail.toLowerCase() }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: REQUEST_CAP,
    // Never the draft, the internal notes, the drafter or the approver.
    select: {
      id: true,
      ticketNumber: true,
      question: true,
      status: true,
      createdAt: true,
      sentAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    ticketNumber: r.ticketNumber,
    question: r.question,
    state: myRequestState(r.status),
    openedAt: r.createdAt.toISOString(),
    answeredAt: r.sentAt?.toISOString() ?? null,
  }));
}

/**
 * My documents: the ID documents on my record (type and expiry only — never
 * the number, which stays encrypted and HR-only) and the evidence I attached to
 * my own goals. Letters HR issues are requested through HR.
 */
export async function myDocuments(employeeId: string) {
  const [employee, evidence] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { civilIdExpiry: true, passportExpiry: true },
    }),
    prisma.kpiEvidence.findMany({
      where: { uploadedByEmployeeId: employeeId, deletedAt: null },
      orderBy: { uploadedAt: "desc" },
      take: 50,
      select: {
        id: true,
        kind: true,
        label: true,
        uploadedAt: true,
        kpi: { select: { description: true } },
      },
    }),
  ]);
  return {
    idDocuments: [
      {
        kind: "CIVIL_ID" as const,
        expiresOn: employee?.civilIdExpiry?.toISOString().slice(0, 10) ?? null,
      },
      {
        kind: "PASSPORT" as const,
        expiresOn: employee?.passportExpiry?.toISOString().slice(0, 10) ?? null,
      },
    ],
    evidence: evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label,
      goal: e.kpi.description,
      uploadedAt: e.uploadedAt.toISOString().slice(0, 10),
    })),
  };
}
