"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";

/**
 * Org setup — spec §1.2. Settings archetype.
 *
 * Entities and departments must exist before an import can place anyone:
 * §3.4 rejects an unrecognised department rather than creating one, precisely so
 * a typo cannot fork the org chart. This is where HR creates the real ones.
 *
 * Note what the department list shows: the same name under two entities is
 * NORMAL ("TP Sales" and "CL Sales" are distinct departments, §1.2), so the
 * entity is always displayed beside the name rather than the list appearing to
 * hold duplicates.
 */

type Entity = {
  id: string;
  code: string;
  name: string;
  _count: { departments: number; employees: number };
};

type Department = {
  id: string;
  name: string;
  entityId: string;
  entity: { id: string; code: string; name: string };
  _count: { employees: number };
};

export default function OrgSetupPage() {
  const t = useTranslations("pms");
  const { capabilities, isLoading: actorLoading } = usePmsActor();
  const { success, error: showError } = useNotify();
  const queryClient = useQueryClient();

  const [entityCode, setEntityCode] = useState("");
  const [entityName, setEntityName] = useState("");
  const [deptName, setDeptName] = useState("");
  const [deptEntityId, setDeptEntityId] = useState("");
  const [busy, setBusy] = useState(false);

  const entities = useQuery({
    queryKey: ["pms", "entities"],
    queryFn: () => apiClient.get<Entity[]>("/api/org/entities"),
  });

  const departments = useQuery({
    queryKey: ["pms", "departments"],
    queryFn: () =>
      apiClient.get<{ data: Department[]; total: number }>("/api/org/departments?pageSize=200"),
  });

  async function createEntity() {
    setBusy(true);
    try {
      await apiClient.post("/api/org/entities", {
        code: entityCode.trim(),
        name: entityName.trim(),
      });
      success(t("orgSetup.entityCreated"));
      setEntityCode("");
      setEntityName("");
      await queryClient.invalidateQueries({ queryKey: ["pms", "entities"] });
    } catch (e) {
      showError(e instanceof ApiError ? e.message : t("orgSetup.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function createDepartment() {
    setBusy(true);
    try {
      await apiClient.post("/api/org/departments", {
        name: deptName.trim(),
        entityId: deptEntityId,
      });
      success(t("orgSetup.departmentCreated"));
      setDeptName("");
      await queryClient.invalidateQueries({ queryKey: ["pms", "departments"] });
      await queryClient.invalidateQueries({ queryKey: ["pms", "entities"] });
    } catch (e) {
      showError(e instanceof ApiError ? e.message : t("orgSetup.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (actorLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("orgSetup.title")} />
        <SectionCard title={t("orgSetup.entities")}>
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        </SectionCard>
      </div>
    );
  }

  if (!capabilities.configure) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("orgSetup.title")} />
        <SectionCard title={t("orgSetup.entities")}>
          {/* §4.1 — HRBP runs the cycle but does not configure the org. */}
          <EmptyState description={t("orgSetup.notPermitted")} />
        </SectionCard>
      </div>
    );
  }

  const entityList = entities.data ?? [];
  const departmentList = departments.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("orgSetup.title")} subtitle={t("orgSetup.subtitle")} />

      <SectionCard title={t("orgSetup.entities")} subtitle={t("orgSetup.entitiesNote")}>
        {entities.isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-muted" />
        ) : entities.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("orgSetup.loadFailed")}
          </p>
        ) : entityList.length === 0 ? (
          <EmptyState description={t("orgSetup.noEntities")} />
        ) : (
          <ul className="mb-4 space-y-2">
            {entityList.map((entity) => (
              <li key={entity.id} className="flex flex-wrap items-center gap-3 text-sm">
                <Badge variant="brand">{entity.code}</Badge>
                <span className="font-medium text-foreground">{entity.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t("orgSetup.entityCounts", {
                    departments: entity._count.departments,
                    employees: entity._count.employees,
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div>
            <label htmlFor="entity-code" className="mb-1 block text-sm font-medium text-foreground">
              {t("orgSetup.entityCode")}
            </label>
            <Input
              id="entity-code"
              value={entityCode}
              onChange={(e) => setEntityCode(e.target.value.toUpperCase())}
              placeholder={t("orgSetup.entityCodePlaceholder")}
              className="w-32 font-mono"
            />
          </div>
          <div>
            <label htmlFor="entity-name" className="mb-1 block text-sm font-medium text-foreground">
              {t("orgSetup.entityName")}
            </label>
            <Input
              id="entity-name"
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              className="w-56"
            />
          </div>
          <Button
            onClick={createEntity}
            disabled={busy || !entityCode.trim() || !entityName.trim()}
          >
            {t("orgSetup.addEntity")}
          </Button>
        </div>
      </SectionCard>

      <SectionCard title={t("orgSetup.departments")} subtitle={t("orgSetup.departmentsNote")}>
        {departments.isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-muted" />
        ) : departments.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("orgSetup.loadFailed")}
          </p>
        ) : departmentList.length === 0 ? (
          <EmptyState description={t("orgSetup.noDepartments")} />
        ) : (
          <ul className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {departmentList.map((department) => (
              <li key={department.id} className="flex items-center gap-2 text-sm">
                {/* The entity is never omitted: §1.2 makes the same name under
                    two entities correct, and a bare name would read as a bug. */}
                <Badge variant="default">{department.entity.code}</Badge>
                <span className="text-foreground">{department.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({department._count.employees})
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div>
            <label htmlFor="dept-entity" className="mb-1 block text-sm font-medium text-foreground">
              {t("entity")}
            </label>
            <select
              id="dept-entity"
              value={deptEntityId}
              onChange={(e) => setDeptEntityId(e.target.value)}
              className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{t("orgSetup.chooseEntity")}</option>
              {entityList.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dept-name" className="mb-1 block text-sm font-medium text-foreground">
              {t("orgSetup.departmentName")}
            </label>
            <Input
              id="dept-name"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              className="w-56"
            />
          </div>
          <Button onClick={createDepartment} disabled={busy || !deptName.trim() || !deptEntityId}>
            {t("orgSetup.addDepartment")}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
