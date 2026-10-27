"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { OfferStatus } from "./types";

/** Small shared pieces of the offer screens. */

const TONE = {
  DRAFTING: "default",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  SENT: "brand",
  ACCEPTED: "success",
  DECLINED: "danger",
  WITHDRAWN: "outline",
} as const;

export function OfferStatusBadge({ status }: { status: OfferStatus }) {
  const t = useTranslations("hiring.offerStatus");
  return <Badge variant={TONE[status]}>{t(status)}</Badge>;
}

/** "1,900 OMR" — offer figures are monthly OMR. */
export const omr = (v: number | null | undefined) =>
  v == null ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: 3 })} OMR`;

/** Allowance label: a known key translates, anything else is shown as typed. */
export function useAllowanceLabel() {
  const t = useTranslations("hiring.allowance");
  const known = new Set(["housing", "transport", "car", "fuel", "phone", "education", "other"]);
  return (key: string) =>
    key === "basic"
      ? t("basic")
      : known.has(key.toLowerCase())
        ? t(key.toLowerCase())
        : t("custom", { name: key });
}

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Muscat",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** "2026-12-01" for a date-only value, read on Muscat's calendar (what a date input wants). */
export const muscatDay = (iso: string) => ymd.format(new Date(iso));
