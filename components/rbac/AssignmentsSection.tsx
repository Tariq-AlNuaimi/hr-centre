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
import { formatDate } from "@/lib/format";
import { AssignmentForm } from "./AssignmentForm";
import type { AssignmentRow, RoleRow } from "./types";

const PAGE_SIZE = 50;

/** Who holds which role, where — and until when (AC-F3.2). */
export function AssignmentsSection() {
  const t = useTranslations("rbac");
  const { success, error: toastError } = useNotify();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const roles = useQuery({
    queryKey: ["rbac", "roles"],
    queryFn: () => apiClient.get<RoleRow[]>("/api/rbac/roles"),
  });
  const assignments = useQuery({
    queryKey: ["rbac", "assignments", page],
    queryFn: () =>
      apiClient.get<{ data: AssignmentRow[]; total: number }>(
        `/api/rbac/assignments?page=${page}&pageSize=${PAGE_SIZE}`,
      ),
  });

  async function remove(a: AssignmentRow) {
    try {
      await apiClient.delete(`/api/rbac/assignments/${a.id}`);
      success(t("removed"));
      await queryClient.invalidateQueries({ queryKey: ["rbac"] });
    } catch (e) {
      toastError(e instanceof ApiError ? e.message : t("saveFailed"));
    }
  }

  const rows = assignments.data?.data ?? [];
  const total = assignments.data?.total ?? 0;
  return (
    <SectionCard title={t("assignments")} subtitle={t("assignmentsNote")}>
      {assignments.isLoading ? (
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      ) : assignments.isError ? (
        <p role="alert" className="text-sm text-destructive-emphasis">
          {t("loadFailed")}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState description={t("noAssignments")} />
      ) : (
        <ul className="mb-4">
          {rows.map((a) => {
            const expired = a.expired;
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-3 border-b border-border py-2 text-sm last:border-b-0"
              >
                <span className="font-medium text-foreground">{a.user.name ?? a.user.email}</span>
                <Badge variant="brand">{a.role.name}</Badge>
                <span className="text-muted-foreground">
                  {a.scopeType === "GROUP"
                    ? t("scopeType.GROUP")
                    : (a.scopeLabel ?? t("unitMissing"))}
                </span>
                {a.validUntil ? (
                  <Badge variant={expired ? "warning" : "default"}>
                    {expired ? t("expired") : t("until", { date: formatDate(a.validUntil) })}
                  </Badge>
                ) : null}
                {a.note ? <span className="text-xs text-muted-foreground">{a.note}</span> : null}
                <span className="ms-auto">
                  <ConfirmAction
                    title={t("removeTitle")}
                    description={t("removeDescription", {
                      role: a.role.name,
                      person: a.user.name ?? a.user.email,
                    })}
                    okText={t("remove")}
                    okType="danger"
                    onConfirm={() => void remove(a)}
                  >
                    <Button size="sm" variant="ghost">
                      {t("remove")}
                    </Button>
                  </ConfirmAction>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {total > PAGE_SIZE ? (
        <div className="mb-4 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("previous")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
          </Button>
        </div>
      ) : null}
      <AssignmentForm roles={roles.data ?? []} />
    </SectionCard>
  );
}
