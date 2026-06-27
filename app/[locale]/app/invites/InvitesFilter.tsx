"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { INVITATION_STATUSES } from "@/lib/validations/invitation";

const STATUSES = INVITATION_STATUSES;

// Status filter (UI-SPEC D.5 "Filter by role/status"). Navigates by query param so
// the list stays a server read (RSC); changing the filter resets to page 1.
export function InvitesFilter({ current }: { current?: string }) {
  const t = useTranslations("invitations");
  const tStatus = useTranslations("invitations.status");
  const router = useRouter();

  function onChange(value: string) {
    const params = new URLSearchParams();
    if (value) params.set("status", value);
    const qs = params.toString();
    router.push(`/app/invites${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="inv-filter" className="text-sm text-muted-foreground">
        {t("filterStatus")}
      </Label>
      <Select
        id="inv-filter"
        className="h-9 w-44"
        value={current ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("filterAllStatuses")}</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {tStatus(s)}
          </option>
        ))}
      </Select>
    </div>
  );
}
