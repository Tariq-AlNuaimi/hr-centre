/**
 * Joiner message types (HR Onboarding §11.2), written to `JmlEmailLog.type` and
 * read back by retry — named constants, values verbatim from the source.
 */
export const EMAIL_TYPES = {
  CANDIDATE_WELCOME: "candidate-welcome",
  DAY_ONE_PACK: "day-one-pack",
  PAYROLL_NOTIFY: "payroll-notification",
  HEADSET_OFFER: "headset-offer",
  IT_REMINDER: "it-reminder",
  PRO_VISA: "pro-visa",
  OVERDUE_DIGEST: "overdue-digest",
  START_DATE_CHANGED: "start-date-changed",
  WELCOME_REVIEW: "welcome-review",
} as const;
