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
import { RoleMatrix } from "./RoleMatrix";
import { RoleHolders } from "./RoleHolders";
import { FilterChips } from "@/components/shared/FilterBar";
import type { RoleRow } from "./types";

/**
 * Roles — named bundles of actions (AC-F3.1). UX P1 R12: a list or a roles ×
 * actions matrix; each role shows who holds it; a role still held cannot be
 * deleted (the server refuses too); built-in roles say they are editable.
 */
export function RolesSection() {
  const t = useTranslations("rbac");
  const { success, error: toastError } = useNotify();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "matrix">("list");
  const [openHolders, setOpenHolders] = useState<string | null>(null);

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
      <div className="mb-4">
        <FilterChips
          label={t("viewLabel")}
          value={view}
          onChange={(v) => setView(v === "matrix" ? "matrix" : "list")}
          chips={[
            { value: "list", label: t("viewList") },
            { value: "matrix", label: t("viewMatrix") },
          ]}
        />
      </div>
      {roles.isLoading ? (
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      ) : roles.isError ? (
        <p role="alert" className="text-sm text-destructive-emphasis">
          {t("loadFailed")}
        </p>
      ) : list.length === 0 ? (
        <EmptyState description={t("noRoles")} />
      ) : view === "matrix" ? (
        <RoleMatrix roles={list} />
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
                {t("roleActions", { actions: role.permissions.length })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={openHolders === role.id}
                onClick={() => setOpenHolders((id) => (id === role.id ? null : role.id))}
              >
                {t("assignedTo", { count: role._count.assignments })}
              </Button>
              <span className="ms-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(role)}>
                  {t("edit")}
                </Button>
                {role._count.assignments > 0 ? (
                  <Button size="sm" variant="ghost" disabled title={t("deleteBlocked")}>
                    {t("delete")}
                  </Button>
                ) : (
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
                )}
              </span>
              {role.description ? (
                <span className="basis-full text-xs text-muted-foreground">{role.description}</span>
              ) : null}
              {openHolders === role.id ? (
                <div className="basis-full rounded-md bg-muted/50 p-3">
                  <RoleHolders roleId={role.id} />
                </div>
              ) : null}
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
