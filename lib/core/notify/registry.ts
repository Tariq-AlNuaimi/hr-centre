import type { NotificationKind } from "@/generated/prisma/client";

/**
 * The notification registry (ADR-095): every kind, the module that raises it,
 * whether it also goes by email, and whether a person may turn it off.
 *
 * MANDATORY kinds are the ones the organisation must be able to rely on being
 * seen — compliance escalations, statutory deadlines, a failed send someone has
 * to act on. Everything else is the recipient's to mute, per channel.
 * `satisfies Record<NotificationKind, …>` makes a new enum value a compile error
 * until it is registered here.
 */

type NotifyModule = "performance" | "jml" | "hiring" | "tickets";

export type KindInfo = {
  module: NotifyModule;
  /** The kind has its own email to the person, which they may turn off. */
  email: boolean;
  mandatory: boolean;
};

export const NOTIFICATION_REGISTRY = {
  // The Performance ladder's email is one digest per person that mixes reminder
  // and escalation lines, so it is not mutable per kind: `email: false` here
  // means "no per-kind email choice", not "never emailed".
  CYCLE_REMINDER: { module: "performance", email: false, mandatory: false },
  CYCLE_ESCALATION: { module: "performance", email: false, mandatory: true },
  HR_INTERVENTION: { module: "performance", email: false, mandatory: true },
  THREE_SIXTY_REMINDER: { module: "performance", email: false, mandatory: false },
  CHANGE_REQUEST_RAISED: { module: "performance", email: false, mandatory: false },
  CHANGE_REQUEST_ACKNOWLEDGED: { module: "performance", email: false, mandatory: false },
  JML_INFO: { module: "jml", email: false, mandatory: false },
  JML_AUTOMATION_FAILURE: { module: "jml", email: false, mandatory: true },
  JML_OVERDUE_TASK_DIGEST: { module: "jml", email: false, mandatory: false },
  JML_OVERDUE_ESCALATION: { module: "jml", email: false, mandatory: true },
  JML_STATUTORY_WATCH_ALERT: { module: "jml", email: false, mandatory: true },
  JML_APPROVAL_REMINDER: { module: "jml", email: false, mandatory: false },
  JML_CASE_ACTIVATED: { module: "jml", email: false, mandatory: false },
  JML_RECALCULATION_NOTICE: { module: "jml", email: false, mandatory: false },
  JML_CASE_CLOSED: { module: "jml", email: false, mandatory: false },
  JML_TASK_ASSIGNED: { module: "jml", email: false, mandatory: false },
  HIRING_APPROVAL_REQUESTED: { module: "hiring", email: false, mandatory: false },
  HIRING_OFFER_DECIDED: { module: "hiring", email: false, mandatory: false },
  HIRING_SCORECARD_DUE: { module: "hiring", email: false, mandatory: false },
  TICKET_TO_DRAFT: { module: "tickets", email: true, mandatory: false },
  TICKET_TO_APPROVE: { module: "tickets", email: true, mandatory: false },
  TICKET_RETURNED: { module: "tickets", email: false, mandatory: false },
} as const satisfies Record<NotificationKind, KindInfo>;

export const NOTIFICATION_KINDS = Object.keys(NOTIFICATION_REGISTRY) as NotificationKind[];

export type Preference = { inApp: boolean; email: boolean };

/**
 * What a person gets for a kind, given their stored choice (if any). Mandatory
 * kinds ignore the choice; a kind with no email channel never emails.
 */
export function effectivePreference(
  kind: NotificationKind,
  stored?: Partial<Preference>,
): Preference {
  const info: KindInfo = NOTIFICATION_REGISTRY[kind];
  if (info.mandatory) return { inApp: true, email: info.email };
  return {
    inApp: stored?.inApp ?? true,
    email: info.email ? (stored?.email ?? true) : false,
  };
}
