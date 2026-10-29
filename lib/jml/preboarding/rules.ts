import { workingDaysBetween, type WorkingCalendar } from "@/lib/working-time/calendar";

/**
 * P2-4 — joiner preboarding: the pure rules (no database), so the form, the
 * routes and the sweep agree on one definition of each.
 *
 * Benchmark: BambooHR's New Hire Packet / "Get to Know You", reminders at two
 * weeks, one week and three days. Here the cadence is counted in WORKING days on
 * the core calendar (ADR-077): 10, 5 and 2 working days before the planned start.
 */

/** The magic-link purpose (ADR-090 namespaces links by purpose). */
export const PREBOARDING_PURPOSE = "jml-preboarding";

/** The documents the starter checklist asks for (§10.2 T04–T07). No files, no numbers (ADR-078). */
export const PREBOARDING_DOCUMENTS = [
  "CIVIL_ID",
  "PASSPORT",
  "QUALIFICATION",
  "ROP_CLEARANCE",
] as const;
export type PreboardingDocument = (typeof PREBOARDING_DOCUMENTS)[number];

export const DOCUMENT_ANSWERS = ["SENT", "WILL_BRING", "NOT_APPLICABLE"] as const;
export type DocumentAnswer = (typeof DOCUMENT_ANSWERS)[number];

/** Which template task each document answer is noted on (the starter template's codes). */
export const DOCUMENT_TASK_CODE: Record<PreboardingDocument, string> = {
  CIVIL_ID: "T04",
  PASSPORT: "T05",
  QUALIFICATION: "T06",
  ROP_CLEARANCE: "T07",
};

/** The two tasks the form itself completes: the picture (T08) and introduction/hobbies (T09). */
export const PHOTO_TASK_CODE = "T08";
export const INTRO_TASK_CODE = "T09";

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png"] as const;

/** Working days before the planned start at which a reminder is due. */
const REMINDER_WORKING_DAYS = [10, 5, 2] as const;

const DAY_MS = 86_400_000;
/** The longest a link lives, whatever the start date. */
const MAX_LINK_DAYS = 60;

/**
 * When a newly issued link should stop working: the end of the planned start
 * day (the form is for BEFORE day one), never more than 60 days out, and at
 * least 3 days so a link issued late still gives the joiner time.
 */
export function linkExpiry(now: Date, plannedStart: Date | null): Date {
  const cap = new Date(now.getTime() + MAX_LINK_DAYS * DAY_MS);
  const floor = new Date(now.getTime() + 3 * DAY_MS);
  if (!plannedStart) return cap;
  const endOfStart = new Date(plannedStart.getTime() + DAY_MS);
  if (endOfStart < floor) return floor;
  return endOfStart < cap ? endOfStart : cap;
}

/** Why a case cannot have a preboarding link, or null. */
export function preboardingBlockedReason(kase: {
  caseType: string;
  status: string;
  employeeStatus: string;
}): string | null {
  if (kase.caseType !== "JOIN") return "Preboarding is for joiners only.";
  if (kase.status === "CANCELLED" || kase.status === "ARCHIVED" || kase.status === "COMPLETED") {
    return "This onboarding is closed.";
  }
  if (kase.employeeStatus !== "PRE_JOINER") {
    return "Preboarding is only for someone who has not started yet.";
  }
  return null;
}

/**
 * Whether a reminder is due today: the number of working days left before the
 * start is one of the cadence points, and none was sent today already.
 */
export function reminderDue(params: {
  today: Date;
  plannedStart: Date;
  lastReminderAt: Date | null;
  startOfToday: Date;
  calendar: WorkingCalendar;
}): boolean {
  const { today, plannedStart, lastReminderAt, startOfToday, calendar } = params;
  if (plannedStart <= today) return false;
  if (lastReminderAt && lastReminderAt >= startOfToday) return false;
  const left = workingDaysBetween(today, plannedStart, calendar);
  return (REMINDER_WORKING_DAYS as readonly number[]).includes(left);
}

/** Normalises a stored documents JSON to known keys and answers only. */
export function readDocuments(raw: unknown): Partial<Record<PreboardingDocument, DocumentAnswer>> {
  const out: Partial<Record<PreboardingDocument, DocumentAnswer>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const doc of PREBOARDING_DOCUMENTS) {
    const v = (raw as Record<string, unknown>)[doc];
    if (typeof v === "string" && (DOCUMENT_ANSWERS as readonly string[]).includes(v)) {
      out[doc] = v as DocumentAnswer;
    }
  }
  return out;
}

/** The private Blob path of a joiner's picture — one per case, overwritten on re-upload. */
export function photoPathname(caseId: string, contentType: string): string {
  return `jml/preboarding/${caseId}/photo.${contentType === "image/png" ? "png" : "jpg"}`;
}
