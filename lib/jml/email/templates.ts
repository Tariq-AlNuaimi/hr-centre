import { prisma } from "@/lib/prisma";
import { EMAIL_TYPES } from "./types";

/**
 * Joiner email copy — HR Onboarding §11.2 (US7, AC-7.2), ported VERBATIM from
 * `lib/services/onboarding/email-templates.ts`, with its administrator override
 * layer (core `EmailTemplate`, module "jml", ADR-095). English only, by the artifact's rule.
 * Variables come from a flat, explicit context — a template can never reach
 * salary or any other Restricted value. `{{caseNumber}}` is the case reference.
 */

export interface TemplateContext {
  fullName: string;
  firstName: string;
  caseNumber: string;
  jobTitle: string;
  companyName: string;
  startDate: string;
  hrOwnerName: string;
}

export interface EmailTemplate {
  type: string;
  /** Recipient class, so the preview screen can say who would receive it. */
  audience: "candidate" | "payroll" | "it" | "pro" | "hr";
  subject: string;
  /** Plain text. The HTML alternate is derived, so the two cannot disagree. */
  body: string;
  /**
   * §11.2's last row is the only message HR SENDS BY HAND: "HR reviews and
   * sends." Marking it here rather than relying on nothing calling it means the
   * preview screen can say so, and a future trigger that tried to queue it
   * would be visibly contradicting the matrix.
   */
  manual?: boolean;
}

/**
 * The §11.2 matrix — all ten rows.
 *
 * The CONTENT COLUMN of §11.2 is approved and is reproduced faithfully: where
 * the artifact enumerates what a message must contain — the seven documents the
 * candidate email requests, the four items in the Day One pack — those items
 * appear here by name. The surrounding PROSE is the build's and HR edits it in
 * the admin screen without a deploy; the enumerated items are not the build's to
 * change (§7.4, AC-BUILD-003).
 *
 * Eight of the ten rows queue automatically. Row 2 (the IT Microsoft Form) is
 * not an email at all — it is the intake integration in `it-intake.ts`. Row 10
 * is `manual`: HR reviews and sends it.
 */
export const TEMPLATES: EmailTemplate[] = [
  {
    type: EMAIL_TYPES.CANDIDATE_WELCOME,
    audience: "candidate",
    subject: "Welcome to {{companyName}}, {{firstName}}",
    // §11.2 row 1 names SEVEN items this email must request. They are listed
    // individually rather than summarised as "your documents", because a
    // candidate who is told to send "documents" sends four of them and the
    // Preboarding checklist then stalls on the other three.
    //
    // NOTE what this asks for versus what the system keeps: the JML module stores
    // none of these files and never captures the ID numbers (ADR-078 — numbers
    // live only in the core record, entered by HR). The checklist tracks receipt.
    body: [
      "Dear {{firstName}},",
      "",
      "Welcome to {{companyName}}. We are looking forward to you joining us as {{jobTitle}} on {{startDate}}.",
      "",
      "To prepare your onboarding, please send the following where they apply to you:",
      "",
      "  1. Civil ID",
      "  2. Passport",
      "  3. Qualification certificate",
      "  4. ROP clearance",
      "  5. A passport-size picture",
      "  6. A short introduction about yourself",
      "  7. Your hobbies and interests",
      "",
      "Your HR contact is {{hrOwnerName}}, who will be in touch with the next steps.",
      "",
      "Kind regards,",
      "{{companyName}} HR",
    ].join("\n"),
  },
  {
    type: EMAIL_TYPES.DAY_ONE_PACK,
    audience: "candidate",
    subject: "Your first day at {{companyName}}",
    // §11.2 row 6 names FOUR things this pack must carry. Each gets its own
    // line: this is the message a new joiner reads on their first morning, and
    // a paragraph that mentions four topics is a paragraph in which the second
    // and third get missed.
    //
    // The Trust Code LINK is supplied by Legal (§11.5) and the system does not
    // control the language of the linked document — hence the placeholder
    // rather than a hardcoded URL.
    body: [
      "Dear {{firstName}},",
      "",
      "Welcome aboard, and congratulations on your first day at {{companyName}}.",
      "",
      "  • Trust Code — please read and acknowledge it at the link HR has sent with this message.",
      "  • Sick leave — a medical certificate is required for any sickness absence; HR can explain how to submit one.",
      "  • WhatsApp group — HR will add you to the team group so you can reach colleagues quickly.",
      "  • Email signature — please set up your signature using the company template before you send external mail.",
      "",
      "{{hrOwnerName}} is your HR contact for anything not covered here.",
    ].join("\n"),
  },
  {
    type: EMAIL_TYPES.HEADSET_OFFER,
    audience: "candidate",
    // AC-7.2 — Permanent Full-Time only. The condition lives in triggers.ts;
    // the template says so too, because a reader of this list should not have
    // to open another file to learn who gets it.
    subject: "Headset contribution — 50%",
    body: [
      "Dear {{firstName}},",
      "",
      "As a permanent full-time employee you are eligible for a 50% contribution towards a headset.",
      "",
      "{{hrOwnerName}} can arrange this.",
    ].join("\n"),
  },
  {
    type: EMAIL_TYPES.PAYROLL_NOTIFY,
    audience: "payroll",
    subject: "Payroll: {{fullName}} joined on {{startDate}}",
    body: [
      "{{fullName}} ({{caseNumber}}) joined {{companyName}} as {{jobTitle}} on {{startDate}}.",
      "",
      "Please add them to the payroll run.",
    ].join("\n"),
  },
  {
    type: EMAIL_TYPES.IT_REMINDER,
    audience: "it",
    subject: "IT setup due: {{fullName}} starts {{startDate}}",
    body: [
      "{{fullName}} ({{caseNumber}}) starts on {{startDate}}.",
      "",
      "Microsoft account, laptop and access-card requirements were submitted with the onboarding request.",
    ].join("\n"),
  },
  {
    type: EMAIL_TYPES.PRO_VISA,
    audience: "pro",
    subject: "Visa action: {{fullName}} ({{caseNumber}})",
    body: [
      "{{fullName}} requires visa processing ahead of a {{startDate}} start.",
      "",
      "HR contact: {{hrOwnerName}}.",
    ].join("\n"),
  },
  {
    type: EMAIL_TYPES.OVERDUE_DIGEST,
    audience: "hr",
    subject: "Overdue onboarding tasks",
    body: [
      "You have overdue onboarding tasks.",
      "",
      "Open the dashboard to see them ordered by how late they are.",
    ].join("\n"),
  },
  {
    // §11.2 row 9. One template serves IT and the PRO because the message is
    // the same fact — the date moved — and splitting it would mean two bodies
    // to keep in step for no difference the recipient could perceive.
    //
    // The LINE MANAGER is the third recipient the artifact names and the one
    // this cannot reach: §19.2 stores Line Manager as a name, not an address
    // (§3.2 gives them no login). `onStartDateChanged` raises an in-system
    // notification asking the HR owner to forward it. See docs/OPEN-ITEMS.md.
    type: EMAIL_TYPES.START_DATE_CHANGED,
    audience: "it",
    subject: "Start date changed: {{fullName}} ({{caseNumber}}) now starts {{startDate}}",
    body: [
      "The start date for {{fullName}} ({{caseNumber}}) has changed.",
      "",
      "New start date: {{startDate}}",
      "Role: {{jobTitle}}, {{companyName}}",
      "",
      "Onboarding due dates and the calendar have been recalculated automatically.",
      "",
      "HR contact: {{hrOwnerName}}.",
    ].join("\n"),
  },
  {
    // §11.2 row 10 — "Welcome email ready | New hire/internal recipients | HR
    // reviews and sends; picture is handled externally and is not stored."
    //
    // MANUAL by design, and that is the requirement rather than an omission.
    // This is the announcement that introduces a new colleague to the company,
    // and the artifact puts a human between the trigger and the send. Nothing
    // queues it; HR opens it, edits it and sends it from the case.
    //
    // The picture is NOT attached and NOT stored (no file storage — ADR-078). Whoever composes the
    // announcement handles the photograph outside this system.
    type: EMAIL_TYPES.WELCOME_REVIEW,
    audience: "hr",
    manual: true,
    subject: "Welcome to the team, {{firstName}}",
    body: [
      "Please join us in welcoming {{firstName}} to {{companyName}}.",
      "",
      "{{fullName}} joins us as {{jobTitle}}, starting {{startDate}}.",
      "",
      "A little about {{firstName}}, in their own words:",
      "",
      "  [paste the introduction and hobbies the candidate sent]",
      "",
      "Their photograph is handled outside this system and is not stored here — attach it when you send.",
    ].join("\n"),
  },
];

export function findTemplate(type: string): EmailTemplate | undefined {
  return TEMPLATES.find((t) => t.type === type);
}

/**
 * Substitute {{variables}}.
 *
 * Unknown placeholders are left VISIBLE as `{{name}}` rather than replaced with
 * an empty string. An email reading "Welcome to , Ahmed" looks broken to a
 * candidate but tells nobody what went wrong; one reading "Welcome to
 * {{companyName}}" is obviously a template fault and gets fixed. Neither should
 * reach a candidate, and the preview below is what catches it.
 */
export function render(template: string, context: TemplateContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const value = (context as unknown as Record<string, string>)[key];
    return value === undefined || value === "" ? whole : value;
  });
}

/** Placeholders present in a template that the context cannot fill. Drives the
 *  preview's warning, so HR sees a broken variable before a candidate does. */
export function missingVariables(template: string, context: TemplateContext): string[] {
  const found = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  const ctx = context as unknown as Record<string, string>;
  return [...new Set(found.filter((key) => !ctx[key]))];
}

/** A context built from a real case, for preview and for sending. */
export async function contextForCase(caseId: string): Promise<TemplateContext | null> {
  const kase = await prisma.jmlCase.findUnique({
    where: { id: caseId },
    select: {
      caseRef: true,
      hrOwner: { select: { name: true } },
      employee: {
        select: {
          name: true,
          jobTitle: true,
          // D8: a joiner's dateOfJoining is the planned start until day one,
          // then the actual start — the same date Onboarding read.
          dateOfJoining: true,
          entity: { select: { name: true } },
        },
      },
    },
  });
  if (!kase) return null;
  const e = kase.employee;
  return {
    fullName: e.name,
    // A heuristic used only in greetings; worst case formal, never wrong.
    firstName: e.name.trim().split(/\s+/)[0] || e.name,
    caseNumber: kase.caseRef,
    jobTitle: e.jobTitle ?? "",
    companyName: e.entity.name,
    startDate: e.dateOfJoining ? e.dateOfJoining.toISOString().slice(0, 10) : "",
    hrOwnerName: kase.hrOwner?.name ?? "",
  };
}

/** Sample context for previewing a template with no case attached. */
export const SAMPLE_CONTEXT: TemplateContext = {
  fullName: "Fatima Al-Hinai",
  firstName: "Fatima",
  caseNumber: "ONB-2026-0001",
  jobTitle: "Software Engineer",
  companyName: "Rihal",
  startDate: "2026-09-06",
  hrOwnerName: "Junior HR 2",
};
