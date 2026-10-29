import type { Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { placeholderEmail } from "@/lib/people/provisional-id";
import { retentionConfig } from "./retention-config";
import { erasePreboardingPhoto } from "../preboarding/reminders";

/**
 * Joiner retention — HR Onboarding `retention.ts` + `anonymise.ts` (§17.3,
 * BR-026). Refuses to run until HR sets a period (JML_RETENTION_DAYS; no
 * default, gate G8); JML_RETENTION_ACTION is `anonymise` (default) or `purge`.
 *
 * What is erased differs from the source because the person is now a core
 * employee: a joiner who STARTED stays an employee — only the onboarding
 * case's own free text, messages and notifications are erased. A joiner who
 * never started (still PRE_JOINER) is erased completely; the row itself stays
 * (other modules may reference it) but carries nothing about the person.
 *
 * Fixed (8.4.3): the line manager's email and the legacy plaintext salary are
 * cleared, notification texts are erased, and the audit JSON of the erased rows
 * is redacted — the source left all four behind.
 */

const ANONYMISED = "[anonymised]";
const BATCH = 50;

function candidateWhere(cutoff: Date): Prisma.JmlCaseWhereInput {
  return {
    caseType: "JOIN",
    anonymisedAt: null,
    OR: [
      { status: "COMPLETED", completedAt: { lte: cutoff } },
      { status: "CANCELLED", cancelledAt: { lte: cutoff } },
      {
        status: "ARCHIVED",
        OR: [{ completedAt: { lte: cutoff } }, { cancelledAt: { lte: cutoff } }],
      },
    ],
  };
}

/** Dry run for the settings screen. */
export async function previewRetention(now = new Date()) {
  const config = retentionConfig();
  if (!config.configured) return { config, wouldProcess: 0, onLegalHold: 0 };
  const cutoff = new Date(now.getTime() - config.days * 86_400_000);
  const where = candidateWhere(cutoff);
  const [wouldProcess, onLegalHold] = await Promise.all([
    prisma.jmlCase.count({ where: { ...where, legalHold: false } }),
    prisma.jmlCase.count({ where: { ...where, legalHold: true } }),
  ]);
  return { config, wouldProcess, onLegalHold };
}

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

async function redactAudit(tx: Tx, entityType: string, ids: string[]) {
  if (ids.length === 0) return;
  // Bounded by the ids of one case; keeps who/when/what, drops the values.
  await tx.auditLog.updateMany({
    where: { entityType, entityId: { in: ids } },
    data: {
      before: { anonymised: true },
      after: { anonymised: true },
      changes: { anonymised: true },
    },
  });
}

async function eraseCaseText(tx: Tx, caseId: string) {
  const tasks = await tx.jmlTask.findMany({ where: { caseId }, select: { id: true }, take: 1000 });
  const taskIds = tasks.map((t) => t.id);
  for (const id of taskIds) {
    await tx.jmlTask.update({
      where: { id },
      data: {
        delayReason: null,
        externalReference: null,
        notApplicableReason: null,
        dueDateOverrideReason: null,
        confirmingParty: null,
      },
      select: { id: true },
    });
  }
  const comments = await tx.jmlTaskComment.findMany({
    where: { taskId: { in: taskIds } },
    select: { id: true },
    take: 5000,
  });
  for (const c of comments) {
    await tx.jmlTaskComment.update({
      where: { id: c.id },
      data: { body: ANONYMISED },
      select: { id: true },
    });
  }
  const emails = await tx.emailLog.findMany({
    where: { caseId },
    select: { id: true },
    take: 500,
  });
  for (const e of emails) {
    await tx.emailLog.update({
      where: { id: e.id },
      data: { recipient: ANONYMISED, subject: ANONYMISED, cc: null, failureReason: null },
      select: { id: true },
    });
  }
  const notes = await tx.notification.findMany({
    where: { caseId },
    select: { id: true },
    take: 500,
  });
  for (const n of notes) {
    await tx.notification.update({
      where: { id: n.id },
      data: { body: ANONYMISED },
      select: { id: true },
    });
  }
  await redactAudit(tx, "JmlTask", taskIds);
  await redactAudit(
    tx,
    "JmlTaskComment",
    comments.map((c) => c.id),
  );
  // Audit rows written before ADR-095 name the model JmlEmailLog; after, EmailLog.
  for (const entityType of ["JmlEmailLog", "EmailLog"])
    await redactAudit(
      tx,
      entityType,
      emails.map((e) => e.id),
    );
  await redactAudit(
    tx,
    "Notification",
    notes.map((n) => n.id),
  );
}

/** A pre-joiner who never started: the whole record goes. */
async function eraseNeverJoined(tx: Tx, employeeId: string) {
  await tx.employee.update({
    where: { id: employeeId },
    data: {
      name: ANONYMISED,
      email: placeholderEmail(),
      personalEmail: null,
      personalPhone: null,
      workPhone: null,
      nationality: null,
      dateOfBirth: null,
      gender: null,
      jobTitle: null,
      workLocation: null,
      managerId: null,
      basicSalary: null,
      basicSalaryEnc: null,
      civilIdNumberEnc: null,
      civilIdExpiry: null,
      passportNumberEnc: null,
      passportExpiry: null,
    },
    select: { id: true },
  });
  await redactAudit(tx, "Employee", [employeeId]);
}

async function anonymiseJoinCase(caseId: string, now = new Date()) {
  const kase = await prisma.jmlCase.findUnique({
    where: { id: caseId },
    select: { employeeId: true, employee: { select: { status: true } } },
  });
  if (!kase) return;
  // P2-4 — the preboarding row (answers and the picture's path) goes with the case.
  const preboarding = await prisma.jmlPreboarding.findUnique({
    where: { caseId },
    select: { photoPathname: true },
  });
  await auditedTransaction(async (tx) => {
    if (preboarding) {
      await tx.jmlPreboarding.delete({ where: { caseId }, select: { caseId: true } });
    }
    await eraseCaseText(tx, caseId);
    await tx.jmlJoinDetail.update({
      where: { caseId },
      data: {
        introSentence: null,
        hobbies: null,
        itIntakeReference: null,
        itIntakeError: null,
        sourceRef: null,
      },
      select: { caseId: true },
    });
    await tx.jmlCase.update({
      where: { id: caseId },
      data: {
        cancelReason: null,
        duplicateOverrideReason: null,
        legalHoldReason: null,
        anonymisedAt: now,
      },
      select: { id: true },
    });
    await redactAudit(tx, "JmlCase", [caseId]);
    await redactAudit(tx, "JmlJoinDetail", [caseId]);
    if (kase.employee.status === "PRE_JOINER") await eraseNeverJoined(tx, kase.employeeId);
  });
  await erasePreboardingPhoto(preboarding?.photoPathname ?? null);
}

/**
 * Purge: erase, then move the case to the recycling bin, whose daily GC
 * hard-deletes it (with its tasks, comments and messages) after the bin's
 * retention — the one audited hard-delete path the platform has.
 */
async function purgeJoinCase(caseId: string, now: Date) {
  await anonymiseJoinCase(caseId, now);
  await prisma.jmlCase.delete({ where: { id: caseId }, select: { id: true } });
}

export async function runRetention(now = new Date()) {
  const config = retentionConfig();
  if (!config.configured) return { skipped: config.reason };
  const cutoff = new Date(now.getTime() - config.days * 86_400_000);
  const where = candidateWhere(cutoff);
  const [batch, heldBack] = await Promise.all([
    prisma.jmlCase.findMany({
      where: { ...where, legalHold: false },
      select: { id: true },
      take: BATCH,
    }),
    prisma.jmlCase.count({ where: { ...where, legalHold: true } }),
  ]);
  for (const c of batch) {
    if (config.action === "purge") await purgeJoinCase(c.id, now);
    else await anonymiseJoinCase(c.id, now);
  }
  return { action: config.action, processed: batch.length, heldBack };
}
