"use client";

import { useTranslations } from "next-intl";

/**
 * `EscalationStatus` → its label, with every key written out literally, and
 * HR's renames from Settings laid over the top when the caller passes them.
 *
 * The obvious shape builds the key from the status with a template literal, and
 * it does not survive the copy gate: `tests/contracts/i18n-keys.test.ts` resolves
 * keys statically, so an interpolated key reads as one missing entry and the
 * real ones go unchecked. next-intl renders a missing key AS THE KEY, so what a
 * dynamic lookup hides is a raw key printed in a table cell — exactly what the
 * gate exists to catch. (That gate scans comments too, which is why this one
 * describes the pattern instead of quoting it.)
 *
 * Written out here once rather than at both call sites, so the queue and the
 * detail screen cannot drift into labelling the same status differently.
 *
 * @public
 */
export function useStatusLabels(overrides?: Record<string, string>): Record<string, string> {
  const t = useTranslations("hive.escalations");
  const builtIn: Record<string, string> = {
    OPEN: t("statusOPEN"),
    IN_PROGRESS: t("statusIN_PROGRESS"),
    PENDING_APPROVAL: t("statusPENDING_APPROVAL"),
    APPROVED: t("statusAPPROVED"),
    SENT: t("statusSENT"),
    SEND_FAILED: t("statusSEND_FAILED"),
    CLOSED: t("statusCLOSED"),
  };
  // HR's renames from Settings (blueprint T5). A blank override never reaches
  // here — the server drops it — so a status cannot render empty.
  return overrides ? { ...builtIn, ...overrides } : builtIn;
}

/**
 * `EscalationSource` → its label (ADR-075). Literal keys, as above.
 *
 * @public
 */
export function useSourceLabels(): Record<string, string> {
  const t = useTranslations("hive.escalations");
  return { HIVE: t("sourceHIVE"), SIRAAJ: t("sourceSIRAAJ"), HR: t("sourceHR") };
}

/**
 * `EscalationEventKind` → its history-line label. Literal keys for the same
 * reason as {@link useStatusLabels}.
 *
 * @public
 */
export function useEventLabels(): Record<string, string> {
  const t = useTranslations("hive.escalations");
  return {
    OPENED: t("eventOPENED"),
    DRAFT_SAVED: t("eventDRAFT_SAVED"),
    SUBMITTED: t("eventSUBMITTED"),
    RETURNED: t("eventRETURNED"),
    APPROVED: t("eventAPPROVED"),
    SENT: t("eventSENT"),
    SEND_FAILED: t("eventSEND_FAILED"),
    REOPENED: t("eventREOPENED"),
    CLOSED: t("eventCLOSED"),
  };
}
