"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

type Tone = "default" | "brand" | "success" | "warning" | "danger" | "info" | "outline";

const REQUISITION_TONE: Record<string, Tone> = {
  DRAFT: "default",
  PENDING_APPROVAL: "warning",
  OPEN: "success",
  ON_HOLD: "warning",
  FILLED: "brand",
  REOPENED: "info",
  CLOSED: "outline",
  ARCHIVED: "outline",
};

const JD_TONE: Record<string, Tone> = {
  DRAFT: "default",
  AWAITING_SIGNOFF: "warning",
  CHANGES_REQUESTED: "danger",
  APPROVED: "success",
};

const NEED_TONE: Record<string, Tone> = {
  ASKED: "default",
  NO_RESPONSE: "danger",
  SUBMITTED: "warning",
  CHALLENGE_AGREED: "success",
  NO_NEED: "default",
};

const TONES = { requisition: REQUISITION_TONE, jd: JD_TONE, need: NEED_TONE } as const;

/** A status pill whose label comes from `hiring.status.<kind>.<VALUE>`. */
export function StatusBadge({ kind, value }: { kind: keyof typeof TONES; value: string }) {
  const t = useTranslations("hiring.status");
  return <Badge variant={TONES[kind][value] ?? "default"}>{t(`${kind}.${value}`)}</Badge>;
}
