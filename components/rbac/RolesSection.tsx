"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { useNotify } from "@/hooks/use-notify";
import { apiClient, ApiError } from "@/lib/api-client";
import { RoleDialog } from "./RoleDialog";
import type { RoleRow } from "./types";

/** Roles — named bundles of actions (AC-F3.1). */
export function RolesSection() {
  const t = useTranslations("rbac");
  const { success, error: toastError } = useNotify();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const roles = useQuery({
    queryKey: ["rbac", "roles"],
    queryFn: () => apiClient.get<RoleRow[]>("/api/rbac/roles"),
  });

  async function save(body: { name: string; description: string; permissions: string[] }) {
    setBusy(true);
    setFormError(null);
    try {
      if (editing === "new") await apiClient.post("/api/rbac/roles", body);
      else if (editing) await apiClient.patch(`/api/rbac/roles/${editing.id}`, body);
      success(t("roleSaved"));
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["rbac"] });
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(role: RoleRow) {
    try {
      await apiClient.delete(`/api/rbac/roles/${role.id}`);
      success(t("roleDeleted"));
      await queryClient.invalidateQueries({ queryKey: ["rbac"] });
    } catch (e) {
      toastError(e instanceof ApiError ? e.message : t("saveFailed"));
    }
  }

  const list = roles.data ?? [];
  return (
    <SectionCard
      title={t("roles")}
      subtitle={t("rolesNote")}
      actions={<Button onClick={() => setEditing("new")}>{t("newRole")}</Button>}
    >
      {roles.isLoading ? (
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      ) : roles.isError ? (
        <p role="alert" className="text-sm text-destructive-emphasis">
          {t("loadFailed")}
        </p>
      ) : list.length === 0 ? (
        <EmptyState description={t("noRoles")} />
      ) : (
        <ul>
          {list.map((role) => (
            <li
              key={role.id}
              className="flex flex-wrap items-center gap-3 border-b border-border py-3 text-sm last:border-b-0"
            >
              <span className="font-medium text-foreground">{role.name}</span>
              {role.starterKey ? <Badge>{t("starter")}</Badge> : null}
              <span className="text-xs text-muted-foreground">
                {t("roleCounts", {
                  actions: role.permissions.length,
                  holders: role._count.assignments,
                })}
              </span>
              {role.description ? (
                <span className="basis-full text-xs text-muted-foreground">{role.description}</span>
              ) : null}
              <span className="ms-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(role)}>
                  {t("edit")}
                </Button>
                <ConfirmAction
                  title={t("deleteTitle", { name: role.name })}
                  description={t("deleteDescription")}
                  okText={t("delete")}
                  okType="danger"
                  onConfirm={() => void remove(role)}
                >
                  <Button size="sm" variant="ghost">
                    {t("delete")}
                  </Button>
                </ConfirmAction>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <RoleDialog
          key={editing === "new" ? "new" : editing.id}
          open
          role={editing === "new" ? null : editing}
          busy={busy}
          error={formError}
          onClose={() => {
            setEditing(null);
            setFormError(null);
          }}
          onSave={(body) => void save(body)}
        />
      ) : null}
    </SectionCard>
  );
}
