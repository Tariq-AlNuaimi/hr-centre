import { prisma } from "@/lib/prisma";
import { isPlaceholderEmail } from "@/lib/people/provisional-id";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import { desks } from "../desks";
import { queueEmail } from "../email/queue";
import { EMAIL_TYPES } from "../email/types";
import { notifyJml } from "../engine/notify";
import { submitAndRecord } from "./it-intake";

/**
 * Joiner messages — HR Onboarding `triggers.ts` (§11.2), ported. Everything is
 * QUEUED (sent in the next working window by the sweep); nothing mails inline.
 * Recipients: the joiner's personal email, the IT / PRO / payroll desks
 * (lib/jml/desks.ts, each off while unset), and the line manager's work email
 * (D13 — the manager is an employee, so the address is on file unless it is
 * still a placeholder, in which case the case owner is told to forward it).
 */

const HEADSET_EMPLOYMENT_TYPE = "PERMANENT";

const CASE_SELECT = {
  id: true,
  caseRef: true,
  hrOwnerUserId: true,
  employee: {
    select: {
      name: true,
      personalEmail: true,
      contractType: true,
      manager: { select: { name: true, email: true } },
    },
  },
  joinDetail: {
    select: { payrollApplicable: true, plannedStartDate: true, actualStartDate: true },
  },
} as const;

async function loadCase(caseId: string) {
  return prisma.jmlCase.findUnique({ where: { id: caseId }, select: CASE_SELECT });
}

async function hasOpenVisaWork(caseId: string): Promise<boolean> {
  const task = await prisma.jmlTask.findFirst({
    where: {
      caseId,
      complianceCategory: "VISA",
      status: { notIn: ["COMPLETED", "NOT_APPLICABLE", "CANCELLED"] },
    },
    select: { id: true },
  });
  return task !== null;
}

/** After activation: welcome the joiner, tell PRO about visa work, submit to IT. */
export async function onActivated(caseId: string): Promise<void> {
  const kase = await loadCase(caseId);
  if (!kase) return;
  if (kase.employee.personalEmail) {
    await queueEmail({
      type: EMAIL_TYPES.CANDIDATE_WELCOME,
      recipient: kase.employee.personalEmail,
      subject: `Welcome to Rihal, ${kase.employee.name}`,
      caseId,
    });
  }
  await notifyProIfVisaRequired(caseId);
  await submitAndRecord(caseId);
}

/** Once per case: the PRO desk hears about open visa work (idempotent). */
async function notifyProIfVisaRequired(caseId: string): Promise<boolean> {
  const pro = await desks.pro();
  if (!pro || !(await hasOpenVisaWork(caseId))) return false;
  const already = await prisma.emailLog.findFirst({
    where: { caseId, type: EMAIL_TYPES.PRO_VISA, status: { not: "CANCELLED" } },
    select: { id: true },
  });
  if (already) return false;
  const kase = await loadCase(caseId);
  if (!kase) return false;
  await queueEmail({
    type: EMAIL_TYPES.PRO_VISA,
    recipient: pro,
    subject: `Visa action: ${kase.employee.name} (${kase.caseRef})`,
    caseId,
  });
  return true;
}

/** Day one: the Day One pack, the headset offer (permanent staff) and payroll. */
export async function onActualStartEntered(caseId: string): Promise<void> {
  const kase = await loadCase(caseId);
  if (!kase) return;
  const e = kase.employee;
  if (e.personalEmail) {
    await queueEmail({
      type: EMAIL_TYPES.DAY_ONE_PACK,
      recipient: e.personalEmail,
      subject: `Your first day at Rihal — ${kase.caseRef}`,
      caseId,
    });
    if (e.contractType === HEADSET_EMPLOYMENT_TYPE) {
      await queueEmail({
        type: EMAIL_TYPES.HEADSET_OFFER,
        recipient: e.personalEmail,
        subject: "Headset contribution — 50%",
        caseId,
      });
    }
  }
  const payroll = await desks.payroll();
  if (payroll && kase.joinDetail?.payrollApplicable) {
    await queueEmail({
      type: EMAIL_TYPES.PAYROLL_NOTIFY,
      recipient: payroll,
      subject: `Payroll: ${e.name} joined ${kase.caseRef}`,
      caseId,
    });
  }
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * The start date moved: IT always, PRO when visa work is open, the line
 * manager by email — or, with no usable address, an in-app note to the case
 * owner to forward it (Onboarding §11.2 row 9).
 */
export async function onStartDateChanged(caseId: string, previousStart: Date | null) {
  const kase = await loadCase(caseId);
  if (!kase) return { queued: [] as string[], lineManagerNeedsForwarding: null as string | null };
  const moved = iso(kase.joinDetail?.plannedStartDate);
  const subject = `Start date changed: ${kase.employee.name} (${kase.caseRef}) now ${moved}`;
  const queued: string[] = [];
  const send = async (who: string, recipient: string) => {
    await queueEmail({ type: EMAIL_TYPES.START_DATE_CHANGED, recipient, subject, caseId });
    queued.push(who);
  };
  const it = await desks.it();
  if (it) await send("it", it);
  const pro = await desks.pro();
  if (pro && (await hasOpenVisaWork(caseId))) await send("pro", pro);
  const manager = kase.employee.manager;
  const managerEmail = manager && !isPlaceholderEmail(manager.email) ? manager.email : null;
  if (managerEmail) {
    await send("lineManager", managerEmail);
    return { queued, lineManagerNeedsForwarding: null };
  }
  if (manager && kase.hrOwnerUserId) {
    await notifyJml(
      [
        {
          kind: "JML_INFO",
          userIds: [kase.hrOwnerUserId],
          body: `Tell ${manager.name} that ${kase.employee.name} now starts ${moved} (was ${iso(previousStart) || "unset"}). No work email is on file for the manager, so this one is yours to forward.`,
          href: `/jml/cases/${caseId}`,
          caseId,
          dedupeBase: `start-moved:${caseId}:${moved}`,
        },
      ],
      await loadWorkingCalendar(),
    );
  }
  return { queued, lineManagerNeedsForwarding: manager?.name ?? null };
}
