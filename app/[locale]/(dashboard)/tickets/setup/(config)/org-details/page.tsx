"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
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
  head: { name: string; jobTitle: string | null } | null;
  /** A HIVE-era leader name, for a unit with no head yet. */
  legacyLeader: string | null;
  order: number;
};
type Info = { companies: Unit[]; directorates: Unit[]; departments: Unit[]; teams: Unit[] };

/**
 * Org-chart details for Siraaj's `hive_org_structure` (HIVE §6.5): the order
 * units are offered in. Who leads each unit is its core head, set in
 * Organisation structure and shown here read-only; the units themselves are HR
 * Centre's core organisation too.
 */
export default function HiveOrgDetailsPage() {
  const t = useTranslations("hive.setup");
  const locale = useLocale();
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
      <PageHeader
        title={t("orgTitle")}
        subtitle={t("orgIntro")}
        actions={
          <Link
            href={`/${locale}/admin/org-setup`}
            className="text-sm text-primary-emphasis underline underline-offset-4"
          >
            {t("setHeadsLink")}
          </Link>
        }
      />
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
  const [order, setOrder] = useState(String(unit.order));
  const [busy, setBusy] = useState(false);
  const changed = order !== String(unit.order);

  async function save() {
    setBusy(true);
    try {
      await apiClient.put("/api/hive/admin/org-info", {
        kind: unit.kind,
        unitId: unit.id,
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
    <div className="grid items-end gap-2 border-b border-border pb-2 last:border-b-0 sm:grid-cols-[1fr_2fr_6rem_auto]">
      <p className="m-0 text-sm font-medium">{unit.name}</p>
      <p className="m-0 text-sm text-muted-foreground">
        {unit.head
          ? [unit.head.name, unit.head.jobTitle].filter(Boolean).join(", ")
          : unit.legacyLeader
            ? t("noHeadLegacy", { name: unit.legacyLeader })
            : t("noHead")}
      </p>
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
