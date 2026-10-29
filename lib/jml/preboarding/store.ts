import { sendEmail } from "@/lib/email";
import { auditedTransaction, prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/** P2-4 — persistence and the email shared by the HR, joiner and sweep halves. */

export type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

/** Find-then-write: the audit extension records the create or the update. */
export async function savePreboarding(
  db: Tx | typeof prisma,
  caseId: string,
  data: Omit<Prisma.JmlPreboardingUncheckedCreateInput, "caseId">,
) {
  const existing = await db.jmlPreboarding.findUnique({
    where: { caseId },
    select: { caseId: true },
  });
  if (existing) {
    await db.jmlPreboarding.update({ where: { caseId }, data, select: { caseId: true } });
  } else {
    await db.jmlPreboarding.create({ data: { caseId, ...data }, select: { caseId: true } });
  }
}

export function sendPreboardingEmail(
  employee: { name: string; personalEmail: string | null; entity: { name: string } | null },
  url: string,
  plannedStart: Date | null,
) {
  const first = employee.name.split(/\s+/)[0] ?? employee.name;
  const company = employee.entity?.name ?? "us";
  return sendEmail({
    to: employee.personalEmail!,
    subject: `Before your first day at ${company}`,
    text: [
      `Dear ${first},`,
      "",
      `Welcome to ${company}.` +
        (plannedStart
          ? ` We look forward to seeing you on ${plannedStart.toISOString().slice(0, 10)}.`
          : ""),
      "",
      "Please take five minutes to introduce yourself and tell us which documents you will send or bring:",
      url,
      "",
      "The link is personal to you; please do not forward it.",
      "",
      `${company} HR`,
    ].join("\n"),
  });
}
