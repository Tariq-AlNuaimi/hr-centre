"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Why is this recorded without the Joiners & leavers process?" — required on
 * the HR Super Admin correction path (docs/blueprints/ux-p0.md, US-2). The
 * server refuses fewer than 10 characters and writes the reason to the audit log.
 */
export const BYPASS_REASON_MIN = 10;

export function BypassReasonField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("pms.edgeCaseRecord");
  return (
    <div className="space-y-1 sm:col-span-2">
      <Label htmlFor={id}>{t("bypassReason")}</Label>
      <Input id={id} value={value} required onChange={(e) => onChange(e.target.value)} />
      <p className="text-xs text-muted-foreground">{t("bypassReasonHelp")}</p>
    </div>
  );
}
