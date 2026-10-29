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
import type { Company, Directorate } from "./types";

/** Directorates — the optional level only Rihal uses today. */
export function DirectoratesSection({
  companies,
  directorates,
}: {
  companies: Company[];
  directorates: Directorate[];
}) {
  const t = useTranslations("org");
  const { run, busy } = useOrgAction(t("saveFailed"));
  const [name, setName] = useState("");
  const [entityId, setEntityId] = useState("");

  return (
    <SectionCard title={t("directorates")} subtitle={t("directoratesNote")}>
      {directorates.length === 0 ? (
        <EmptyState description={t("noDirectorates")} />
      ) : (
        <ul className="mb-4">
          {directorates.map((d) => (
            <UnitRow
              key={d.id}
              name={d.name}
              badge={<Badge>{d.entity.code}</Badge>}
              head={
                <HeadControl kind="DIRECTORATE" unitId={d.id} unitName={d.name} head={d.head} />
              }
              meta={t("directorateCounts", { departments: d._count.departments })}
              busy={busy}
              onRename={(next) =>
                run(
                  () => apiClient.patch(`/api/org/directorates/${d.id}`, { name: next }),
                  t("renamed"),
                )
              }
              onRetire={() =>
                void run(() => apiClient.delete(`/api/org/directorates/${d.id}`), t("retired"))
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
            () => apiClient.post("/api/org/directorates", { name: name.trim(), entityId }),
            t("created"),
          );
          if (ok) setName("");
        }}
      >
        <div>
          <label htmlFor="dir-company" className="mb-1 block text-sm font-medium text-foreground">
            {t("company")}
          </label>
          <NativeSelect
            id="dir-company"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            className="w-44"
          >
            <option value="">{t("choose")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor="dir-name" className="mb-1 block text-sm font-medium text-foreground">
            {t("directorateName")}
          </label>
          <Input
            id="dir-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-56"
          />
        </div>
        <Button type="submit" disabled={busy || !name.trim() || !entityId}>
          {t("addDirectorate")}
        </Button>
      </form>
    </SectionCard>
  );
}
