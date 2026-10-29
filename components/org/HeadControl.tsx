"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmployeePicker } from "@/components/pms/EmployeePicker";
import { apiClient } from "@/lib/api-client";
import { useOrgAction } from "./useOrgAction";
import type { UnitHead } from "./types";

export type HeadKind = "COMPANY" | "DIRECTORATE" | "DEPARTMENT" | "TEAM";

/**
 * A unit's head inside its Organisation structure row (overnight item 2):
 * "Head: Name", Change / Clear, or "Set head" — an active employee picked from
 * the directory. The server refuses a leaver or a retired unit with a sentence.
 */
export function HeadControl({
  kind,
  unitId,
  unitName,
  head,
}: {
  kind: HeadKind;
  unitId: string;
  unitName: string;
  head: UnitHead;
}) {
  const t = useTranslations("org.head");
  const { run, busy } = useOrgAction(t("saveFailed"));
  const [picking, setPicking] = useState(false);
  const put = (headEmployeeId: string | null, done: string) =>
    run(() => apiClient.put("/api/org/heads", { kind, unitId, headEmployeeId }), done);

  if (picking) {
    return (
      <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
        <div className="w-64">
          <EmployeePicker
            id={`head-${unitId}`}
            label={t("pickLabel", { name: unitName })}
            exclude={head ? [head.id] : []}
            onPick={async (person) => {
              if (await put(person.id, t("saved", { name: person.name }))) setPicking(false);
            }}
          />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
          {t("cancel")}
        </Button>
      </div>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {head
          ? head.status === "LEAVER"
            ? t("labelLeft", { name: head.name })
            : t("label", { name: head.name })
          : t("none")}
      </span>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPicking(true)}>
        {head ? t("change") : t("set")}
      </Button>
      {head ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void put(null, t("cleared"))}
        >
          {t("clear")}
        </Button>
      ) : null}
    </span>
  );
}
