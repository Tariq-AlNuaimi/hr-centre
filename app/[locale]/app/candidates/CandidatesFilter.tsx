"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DECISION_OUTCOMES } from "@/lib/validations/result";

// Role + decision filter (UI-SPEC D.6). Navigates by query param so the list stays
// a server read (RSC); changing a filter resets to page 1.
export function CandidatesFilter({
  roleProfiles,
  currentRole,
  currentDecision,
}: {
  roleProfiles: { id: string; title: string }[];
  currentRole?: string;
  currentDecision?: string;
}) {
  const t = useTranslations("candidates");
  const tDecision = useTranslations("candidates.decision");
  const router = useRouter();

  function navigate(next: { role?: string; decision?: string }) {
    const params = new URLSearchParams();
    const role = next.role ?? currentRole;
    const decision = next.decision ?? currentDecision;
    if (next.role !== undefined ? next.role : role) {
      const v = next.role !== undefined ? next.role : role;
      if (v) params.set("role", v);
    }
    if (next.decision !== undefined ? next.decision : decision) {
      const v = next.decision !== undefined ? next.decision : decision;
      if (v) params.set("decision", v);
    }
    const qs = params.toString();
    router.push(`/app/candidates${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <Label htmlFor="cand-role" className="text-sm text-muted-foreground">
          {t("filterRole")}
        </Label>
        <Select
          id="cand-role"
          className="h-9 w-48"
          value={currentRole ?? ""}
          onChange={(e) => navigate({ role: e.target.value })}
        >
          <option value="">{t("filterAllRoles")}</option>
          {roleProfiles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="cand-decision" className="text-sm text-muted-foreground">
          {t("filterDecision")}
        </Label>
        <Select
          id="cand-decision"
          className="h-9 w-44"
          value={currentDecision ?? ""}
          onChange={(e) => navigate({ decision: e.target.value })}
        >
          <option value="">{t("filterAllDecisions")}</option>
          {DECISION_OUTCOMES.map((d) => (
            <option key={d} value={d}>
              {tDecision(d)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
