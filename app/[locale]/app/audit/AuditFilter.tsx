"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Select } from "@/components/ui/select";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/validations/audit";

// Audit filter bar (UI-SPEC D.10). Navigates by query param so the list stays an RSC
// read; changing a filter resets to page 1. Mirrors CandidatesFilter.
export function AuditFilter({
  currentAction,
  currentEntity,
}: {
  currentAction: string;
  currentEntity: string;
}) {
  const t = useTranslations("audit");
  const router = useRouter();
  const pathname = usePathname();

  function navigate(next: { action?: string; entityType?: string }) {
    const action = next.action !== undefined ? next.action : currentAction;
    const entityType = next.entityType !== undefined ? next.entityType : currentEntity;
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (entityType) params.set("entityType", entityType);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="audit-action" className="text-xs text-muted-foreground">
          {t("filterAction")}
        </label>
        <Select
          id="audit-action"
          value={currentAction}
          onChange={(e) => navigate({ action: e.target.value })}
          className="min-w-40"
        >
          <option value="">{t("filterAll")}</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`action${a}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="audit-entity" className="text-xs text-muted-foreground">
          {t("filterEntity")}
        </label>
        <Select
          id="audit-entity"
          value={currentEntity}
          onChange={(e) => navigate({ entityType: e.target.value })}
          className="min-w-44"
        >
          <option value="">{t("filterAll")}</option>
          {AUDIT_ENTITY_TYPES.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
