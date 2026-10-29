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
import { HeadControl } from "./HeadControl";
import { UnitRow } from "./UnitRow";
import { useOrgAction } from "./useOrgAction";
import type { Department, Team } from "./types";

/** Teams inside a department. A team moves department only while empty. */
export function TeamsSection({ departments, teams }: { departments: Department[]; teams: Team[] }) {
  const t = useTranslations("org");
  const { run, busy } = useOrgAction(t("saveFailed"));
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const label = (d: Department) => `${d.entity.code} · ${d.name}`;

  return (
    <SectionCard title={t("teams")} subtitle={t("teamsNote")}>
      {teams.length === 0 ? (
        <EmptyState description={t("noTeams")} />
      ) : (
        <ul className="mb-4">
          {teams.map((team) => (
            <UnitRow
              key={team.id}
              name={team.name}
              badge={<Badge>{team.department.entity.code}</Badge>}
              head={
                <HeadControl kind="TEAM" unitId={team.id} unitName={team.name} head={team.head} />
              }
              meta={t("teamCounts", {
                department: team.department.name,
                people: team._count.employees,
              })}
              busy={busy}
              extra={
                <NativeSelect
                  aria-label={t("moveTeam", { name: team.name })}
                  value={team.departmentId}
                  disabled={busy}
                  className="w-56"
                  onChange={(e) =>
                    void run(
                      () =>
                        apiClient.patch(`/api/org/teams/${team.id}`, {
                          departmentId: e.target.value,
                        }),
                      t("moved"),
                    )
                  }
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {label(d)}
                    </option>
                  ))}
                </NativeSelect>
              }
              onRename={(next) =>
                run(
                  () => apiClient.patch(`/api/org/teams/${team.id}`, { name: next }),
                  t("renamed"),
                )
              }
              onRetire={() =>
                void run(() => apiClient.delete(`/api/org/teams/${team.id}`), t("retired"))
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
            () => apiClient.post("/api/org/teams", { name: name.trim(), departmentId }),
            t("created"),
          );
          if (ok) setName("");
        }}
      >
        <div>
          <label htmlFor="team-dept" className="mb-1 block text-sm font-medium text-foreground">
            {t("department")}
          </label>
          <NativeSelect
            id="team-dept"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-56"
          >
            <option value="">{t("choose")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {label(d)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor="team-name" className="mb-1 block text-sm font-medium text-foreground">
            {t("teamName")}
          </label>
          <Input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-56"
          />
        </div>
        <Button type="submit" disabled={busy || !name.trim() || !departmentId}>
          {t("addTeam")}
        </Button>
      </form>
    </SectionCard>
  );
}
