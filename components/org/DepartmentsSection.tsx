"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { apiClient } from "@/lib/api-client";
import { NativeSelect } from "./NativeSelect";
import { UnitRow } from "./UnitRow";
import { useOrgAction } from "./useOrgAction";
import { decodePlacement, encodePlacement, placementOptions } from "./placement";
import type { Company, Department, Directorate } from "./types";

/**
 * Departments sit directly under a company (TP, CL) or under a directorate
 * (Rihal). The "Place" select moves one across both levels; the server refuses
 * a company move while the department has people (AC-F1.1).
 */
export function DepartmentsSection({
  companies,
  directorates,
  departments,
}: {
  companies: Company[];
  directorates: Directorate[];
  departments: Department[];
}) {
  const t = useTranslations("org");
  const { run, busy } = useOrgAction(t("saveFailed"));
  const [name, setName] = useState("");
  const [placement, setPlacement] = useState("");
  const options = placementOptions(companies, directorates);

  return (
    <SectionCard title={t("departments")} subtitle={t("departmentsNote")}>
      {departments.length === 0 ? (
        <EmptyState description={t("noDepartments")} />
      ) : (
        <ul className="mb-4">
          {departments.map((d) => (
            <UnitRow
              key={d.id}
              name={d.name}
              badge={<Badge>{d.entity.code}</Badge>}
              meta={t("departmentCounts", {
                directorate: d.directorate?.name ?? t("directlyUnderCompany"),
                people: d._count.employees,
                teams: d._count.teams,
              })}
              busy={busy}
              extra={
                <NativeSelect
                  aria-label={t("moveDepartment", { name: d.name })}
                  value={encodePlacement(d.entityId, d.directorateId)}
                  disabled={busy}
                  className="w-56"
                  onChange={(e) =>
                    void run(
                      () =>
                        apiClient.patch(
                          `/api/org/departments/${d.id}`,
                          decodePlacement(e.target.value),
                        ),
                      t("moved"),
                    )
                  }
                >
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              }
              onRename={(next) =>
                run(
                  () => apiClient.patch(`/api/org/departments/${d.id}`, { name: next }),
                  t("renamed"),
                )
              }
              onRetire={() =>
                void run(() => apiClient.delete(`/api/org/departments/${d.id}`), t("retired"))
              }
            />
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-3 border-t border-border pt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(
            () =>
              apiClient.post("/api/org/departments", {
                name: name.trim(),
                ...decodePlacement(placement),
              }),
            t("created"),
          );
          if (ok) setName("");
        }}
      >
        <div>
          <label htmlFor="dept-place" className="mb-1 block text-sm font-medium text-foreground">
            {t("place")}
          </label>
          <NativeSelect
            id="dept-place"
            value={placement}
            onChange={(e) => setPlacement(e.target.value)}
            className="w-56"
          >
            <option value="">{t("choose")}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor="dept-name" className="mb-1 block text-sm font-medium text-foreground">
            {t("departmentName")}
          </label>
          <Input
            id="dept-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-56"
          />
        </div>
        <Button type="submit" disabled={busy || !name.trim() || !placement}>
          {t("addDepartment")}
        </Button>
      </form>
    </SectionCard>
  );
}
