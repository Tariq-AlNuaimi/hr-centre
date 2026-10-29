import { auditedTransaction, prisma } from "@/lib/prisma";
import { deleteStoredFile, isStorageConfigured, putPrivateFile } from "@/lib/storage";
import { resolveMagicLink } from "@/lib/core/tokens/magic-link";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import type { PreboardingSubmit } from "@/lib/validations/jml/preboarding";
import { JmlError } from "../errors";
import { canCompleteTask } from "../engine/gates";
import { notifyJml } from "../engine/notify";
import { GATE_SELECT, refreshCase } from "../engine/tasks";
import {
  DOCUMENT_TASK_CODE,
  INTRO_TASK_CODE,
  MAX_PHOTO_BYTES,
  PHOTO_TASK_CODE,
  PHOTO_TYPES,
  PREBOARDING_DOCUMENTS,
  PREBOARDING_PURPOSE,
  photoPathname,
  preboardingBlockedReason,
  readDocuments,
} from "./rules";
import { savePreboarding } from "./store";
import type { Tx } from "./store";

/** P2-4 — the joiner side of preboarding (token-authorised). See `hr.ts` for the design. */

// --- Joiner side (token) ---------------------------------------------------

/**
 * Resolve a raw token to the one case it opens, or null — the same null for
 * every failure (malformed, unknown, expired, revoked, closed case, started).
 */
export async function resolvePreboarding(raw: string): Promise<{ caseId: string } | null> {
  const link = await resolveMagicLink(PREBOARDING_PURPOSE, raw);
  if (!link) return null;
  const kase = await prisma.jmlCase.findUnique({
    where: { id: link.subjectId },
    select: { id: true, caseType: true, status: true, employee: { select: { status: true } } },
  });
  if (!kase) return null;
  const blocked = preboardingBlockedReason({
    caseType: kase.caseType,
    status: kase.status,
    employeeStatus: kase.employee.status,
  });
  return blocked ? null : { caseId: kase.id };
}

/** What the joiner's page shows: their first name, the company, the date, their answers. */
export async function preboardingView(caseId: string) {
  const [kase, row] = await Promise.all([
    prisma.jmlCase.findUnique({
      where: { id: caseId },
      select: {
        employee: { select: { name: true, entity: { select: { name: true } } } },
        joinDetail: { select: { plannedStartDate: true, introSentence: true, hobbies: true } },
        hrOwner: { select: { name: true } },
      },
    }),
    prisma.jmlPreboarding.findUnique({
      where: { caseId },
      select: { submittedAt: true, documents: true, photoUploadedAt: true },
    }),
  ]);
  if (!kase) return null;
  return {
    firstName: kase.employee.name.split(/\s+/)[0] ?? kase.employee.name,
    companyName: kase.employee.entity?.name ?? null,
    hrOwnerName: kase.hrOwner?.name ?? null,
    plannedStartDate: kase.joinDetail?.plannedStartDate?.toISOString().slice(0, 10) ?? null,
    introSentence: kase.joinDetail?.introSentence ?? null,
    hobbies: kase.joinDetail?.hobbies ?? null,
    documents: readDocuments(row?.documents),
    submittedAt: row?.submittedAt?.toISOString() ?? null,
    photoUploaded: Boolean(row?.photoUploadedAt),
    storageConfigured: isStorageConfigured(),
  };
}

const NOTE_LABEL: Record<string, string> = {
  SENT: "says they have sent it to HR",
  WILL_BRING: "will bring it on the first day",
  NOT_APPLICABLE: "says it does not apply to them",
};

/**
 * Complete one template task by its code, as the system, if its gates allow.
 * Silent when the task is absent, already done or gated: the form never fails
 * because a template was customised.
 */
async function completeByCode(tx: Tx, caseId: string, code: string, note: string) {
  const all = await tx.jmlTask.findMany({ where: { caseId }, select: GATE_SELECT, take: 1000 });
  const task = all.find((t) => t.code === code);
  if (!task || task.status === "COMPLETED" || task.status === "NOT_APPLICABLE") return false;
  if (!canCompleteTask(task, all).allowed) return false;
  await tx.jmlTask.update({
    where: { id: task.id },
    data: { status: "COMPLETED", completedAt: new Date(), version: { increment: 1 } },
    select: { id: true },
  });
  await tx.jmlTaskComment.create({ data: { taskId: task.id, body: note }, select: { id: true } });
  return true;
}

async function noteOnCode(tx: Tx, caseId: string, code: string, note: string) {
  const task = await tx.jmlTask.findFirst({
    where: { caseId, code },
    select: { id: true },
  });
  if (task) {
    await tx.jmlTaskComment.create({ data: { taskId: task.id, body: note }, select: { id: true } });
  }
}

/** The joiner submits the form. Re-submitting replaces their answers. */
export async function submitPreboarding(caseId: string, input: PreboardingSubmit) {
  const before = await prisma.jmlPreboarding.findUnique({
    where: { caseId },
    select: { documents: true, submittedAt: true },
  });
  const previous = readDocuments(before?.documents);
  const completed = await auditedTransaction(async (tx) => {
    await tx.jmlJoinDetail.update({
      where: { caseId },
      data: {
        ...(input.introSentence !== undefined ? { introSentence: input.introSentence } : {}),
        ...(input.hobbies !== undefined ? { hobbies: input.hobbies } : {}),
      },
      select: { caseId: true },
    });
    await savePreboarding(tx, caseId, {
      submittedAt: new Date(),
      documents: { ...previous, ...input.documents },
    });
    const done: string[] = [];
    if (input.introSentence || input.hobbies) {
      const ok = await completeByCode(
        tx,
        caseId,
        INTRO_TASK_CODE,
        "Received through the joiner's preboarding form.",
      );
      if (ok) done.push(INTRO_TASK_CODE);
    }
    for (const doc of PREBOARDING_DOCUMENTS) {
      const answer = input.documents[doc];
      if (answer && answer !== previous[doc]) {
        await noteOnCode(
          tx,
          caseId,
          DOCUMENT_TASK_CODE[doc],
          `Preboarding form: the joiner ${NOTE_LABEL[answer]}.`,
        );
      }
    }
    await refreshCase(tx, caseId, null);
    return done;
  });
  await notifyOwner(caseId, before?.submittedAt ? "updated" : "completed");
  return { completedTasks: completed };
}

/** The joiner uploads their passport-size picture (T08). */
export async function uploadPreboardingPhoto(caseId: string, file: File) {
  if (!isStorageConfigured()) throw new JmlError("Uploads are not available yet.", 503);
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
    throw new JmlError("Upload a JPEG or PNG picture.", 422);
  }
  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) {
    throw new JmlError("The picture must be smaller than 2 MB.", 422);
  }
  const pathname = photoPathname(caseId, file.type);
  const previous = await prisma.jmlPreboarding.findUnique({
    where: { caseId },
    select: { photoPathname: true },
  });
  await putPrivateFile(pathname, Buffer.from(await file.arrayBuffer()), file.type, {
    overwrite: true,
  });
  if (previous?.photoPathname && previous.photoPathname !== pathname) {
    await deleteStoredFile(previous.photoPathname).catch(() => undefined);
  }
  await auditedTransaction(async (tx) => {
    await savePreboarding(tx, caseId, {
      photoPathname: pathname,
      photoContentType: file.type,
      photoUploadedAt: new Date(),
    });
    await completeByCode(
      tx,
      caseId,
      PHOTO_TASK_CODE,
      "Picture uploaded through the preboarding form.",
    );
    await refreshCase(tx, caseId, null);
  });
  return { uploaded: true };
}

async function notifyOwner(caseId: string, what: "completed" | "updated") {
  const kase = await prisma.jmlCase.findUnique({
    where: { id: caseId },
    select: { caseRef: true, hrOwnerUserId: true, employee: { select: { name: true } } },
  });
  if (!kase?.hrOwnerUserId) return;
  const calendar = await loadWorkingCalendar();
  await notifyJml(
    [
      {
        kind: "JML_INFO",
        userIds: [kase.hrOwnerUserId],
        body: `${kase.employee.name} ${what} their preboarding form (${kase.caseRef}).`,
        href: `/jml/cases/${caseId}?tab=overview`,
        caseId,
        dedupeBase: `preboarding-${what}:${caseId}:${new Date().toISOString().slice(0, 13)}`,
      },
    ],
    calendar,
  );
}
