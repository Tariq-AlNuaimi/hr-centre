"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";

type Unit = {
  kind: "COMPANY" | "DIRECTORATE" | "DEPARTMENT" | "TEAM";
  id: string;
  name: string;
  leaderName: string | null;
  leaderTitle: string | null;
  order: number;
};
type Info = { companies: Unit[]; directorates: Unit[]; departments: Unit[]; teams: Unit[] };

/**
 * Org-chart details for Siraaj's `hive_org_structure` (HIVE §6.5): who leads
 * each unit and the order units are offered in. The units themselves are HR
 * Centre's core organisation (Admin → Organisation); this only describes them.
 */
export default function HiveOrgDetailsPage() {
  const t = useTranslations("hive.setup");
  const info = useQuery({
    queryKey: ["hive-org-info"],
    queryFn: () => apiClient.get<Info>("/api/hive/admin/org-info"),
  });
  const sections: Array<[string, Unit[]]> = info.data
    ? [
        [t("companies"), info.data.companies],
        [t("directorates"), info.data.directorates],
        [t("departments"), info.data.departments],
        [t("teams"), info.data.teams],
      ]
    : [];
  return (
    <>
      <PageHeader title={t("orgTitle")} subtitle={t("orgIntro")} />
      {info.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : info.isError ? (
        <p role="alert" className="text-sm text-destructive-emphasis">
          {t("loadFailed")}
        </p>
      ) : (
        <div className="space-y-6">
          {sections.map(([title, units]) => (
            <SectionCard key={title} title={title}>
              {units.length === 0 ? (
                <EmptyState description={t("noUnits")} />
              ) : (
                <div className="space-y-2">
                  {units.map((u) => (
                    <UnitRow key={u.id} unit={u} />
                  ))}
                </div>
              )}
            </SectionCard>
          ))}
        </div>
      )}
    </>
  );
}

function UnitRow({ unit }: { unit: Unit }) {
  const t = useTranslations("hive.setup");
  const { success, error: notifyError } = useNotify();
  const queryClient = useQueryClient();
  const [leaderName, setLeaderName] = useState(unit.leaderName ?? "");
  const [leaderTitle, setLeaderTitle] = useState(unit.leaderTitle ?? "");
  const [order, setOrder] = useState(String(unit.order));
  const [busy, setBusy] = useState(false);
  const changed =
    leaderName !== (unit.leaderName ?? "") ||
    leaderTitle !== (unit.leaderTitle ?? "") ||
    order !== String(unit.order);

  async function save() {
    setBusy(true);
    try {
      await apiClient.put("/api/hive/admin/org-info", {
        kind: unit.kind,
        unitId: unit.id,
        leaderName,
        leaderTitle,
        order: Number(order || 0),
      });
      success(t("saved"));
      await queryClient.invalidateQueries({ queryKey: ["hive-org-info"] });
    } catch (e) {
      notifyError(e instanceof ApiError ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const id = `${unit.kind}-${unit.id}`;
  return (
    <div className="grid items-end gap-2 border-b border-border pb-2 last:border-b-0 sm:grid-cols-[1fr_1fr_1fr_6rem_auto]">
      <p className="m-0 text-sm font-medium">{unit.name}</p>
      <div>
        <label htmlFor={`${id}-leader`} className="sr-only">
          {t("field.leaderName")}
        </label>
        <Input
          id={`${id}-leader`}
          placeholder={t("field.leaderName")}
          value={leaderName}
          onChange={(e) => setLeaderName(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${id}-title`} className="sr-only">
          {t("field.leaderTitle")}
        </label>
        <Input
          id={`${id}-title`}
          placeholder={t("field.leaderTitle")}
          value={leaderTitle}
          onChange={(e) => setLeaderTitle(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${id}-order`} className="sr-only">
          {t("field.order")}
        </label>
        <Input
          id={`${id}-order`}
          type="number"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
        />
      </div>
      <Button size="sm" disabled={!changed || busy} onClick={() => void save()}>
        {t("save")}
      </Button>
    </div>
  );
}
