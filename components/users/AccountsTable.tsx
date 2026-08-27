"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/shared/DataTable";
import type { SortChange } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { getRowActionsColumn } from "@/components/shared/RowActions";
import { useEntityList, useEntityMutations } from "@/hooks/use-entity-queries";
import { useNotify } from "@/hooks/use-notify";
import { formatDate } from "@/lib/format";

/**
 * The LOGIN half of the access screen — ADR-070.
 *
 * Extracted verbatim from the old `/users` page so the merge is a re-composition
 * rather than a rewrite, then changed in exactly two ways:
 *
 *   1. The three-value role column became one yes/no column. `EDITOR` gated
 *      nothing and `VIEWER` gated nothing, so a filter offering all three was
 *      offering two spellings of the same answer.
 *   2. Each row now carries the person's §4.1 HR roles. That is the whole point
 *      of the merge: "what can this person do?" is one row, not two screens.
 *      Safe here because this list is admin-only (`withAdminAuth`) — see the
 *      note on the join in app/api/users/route.ts.
 *
 * Rendered only for a platform administrator. The route enforces the same thing;
 * this is the affordance, never the control.
 */

export interface AccountRow {
  id: string;
  email: string;
  name: string | null;
  /** The stored enum. Kept for the recycling bin / audit log vocabulary. */
  role: string;
  /** ADR-070 — the same fact as a question anyone can answer. */
  isPlatformAdmin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  /**
   * The linked employee, or null. Null is NORMAL, not a data error: the
   * bootstrap admin on every deployment has no employee record, and neither
   * would an IT service account (ADR-065). Rendering it as a missing record
   * would be the wrong story about the most privileged account in the system.
   */
  employee: { id: string; name: string; pmsRoles: string[] } | null;
}

export function AccountsTable() {
  const t = useTranslations("users");
  const tPms = useTranslations("pms");
  const router = useRouter();
  const locale = useLocale();
  const { success, error: showError } = useNotify();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortChange>({});
  const [platformAdmin, setPlatformAdmin] = useState<string>();

  const params: Record<string, string> = {
    page: String(page),
    pageSize: String(pageSize),
    ...(search ? { search } : {}),
    ...(sort.field ? { sort: sort.field } : {}),
    ...(sort.order ? { order: sort.order === "ascend" ? "asc" : "desc" } : {}),
    ...(platformAdmin ? { platformAdmin } : {}),
  };

  const { data, isLoading } = useEntityList<AccountRow>("/api/users", params, t("loadFailed"));
  const { remove } = useEntityMutations<AccountRow>("/api/users");

  const handleDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      success(t("deleted"));
    } catch {
      showError(t("deleteFailed"));
    }
  };

  const columns = [
    {
      title: t("name"),
      dataIndex: "name",
      key: "name",
      sorter: true,
      render: (value: string | null, record: AccountRow) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-medium text-foreground">{value ?? record.email}</span>
          <span className="truncate text-xs text-muted-foreground">{record.email}</span>
        </div>
      ),
    },
    {
      /*
        ADR-070 — one checkbox's worth of truth, rendered as one badge.

        The old column showed ADMIN / EDITOR / VIEWER in three tones, which read
        as a ladder. It was not one: everything below ADMIN was the same rung.
        The retired third value landed in "Standard" here for as long as any row
        still carried it, which is what it had always meant in practice. ADR-070
        later retired it from the enum outright, so no row can carry it now.
      */
      title: t("platformAdmin"),
      dataIndex: "isPlatformAdmin",
      key: "isPlatformAdmin",
      render: (value: boolean) =>
        value ? (
          <Badge variant="danger">{t("platformAdminYes")}</Badge>
        ) : (
          <Badge variant="default">{t("platformAdminNo")}</Badge>
        ),
      filters: [
        { text: t("platformAdminYes"), value: "true" },
        { text: t("platformAdminNo"), value: "false" },
      ],
      filterMultiple: false,
    },
    {
      /*
        The other authority system, read-only, on the same row (§4.1 / ADR-065).

        Read-only deliberately: granting HR authority is an HR Super Admin's
        decision, and a platform admin editing it here would be exactly the
        privilege crossing ADR-065 separated the two tables to prevent. Shown,
        because a platform admin about to delete an account should be able to see
        that they are deleting the HRBP's.
      */
      title: tPms("roles.currentRoles"),
      dataIndex: "employee",
      key: "pmsRoles",
      render: (value: AccountRow["employee"]) => {
        if (value === null) {
          return <span className="text-xs text-muted-foreground">{t("noEmployeeRecord")}</span>;
        }
        if (value.pmsRoles.length === 0) {
          return <span className="text-xs text-muted-foreground">{tPms("roles.noRoles")}</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {value.pmsRoles.map((role) => (
              <Badge key={role} variant="brand">
                {tPms(`roles.roleName.${role}`)}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      title: t("lastLogin"),
      dataIndex: "lastLoginAt",
      key: "lastLoginAt",
      render: (val: string | null) => (val ? formatDate(val) : "-"),
      sorter: true,
    },
    getRowActionsColumn<AccountRow>({
      onEdit: (id) => router.push(`/${locale}/admin/access/${id}`),
      onDelete: handleDelete,
      t,
    }),
  ];

  return (
    <DataTable<AccountRow>
      rowKey="id"
      columns={columns}
      dataSource={data?.data ?? []}
      loading={isLoading}
      total={data?.total ?? 0}
      page={page}
      pageSize={pageSize}
      onPageChange={(p, ps) => {
        setPage(p);
        setPageSize(ps);
      }}
      onSortChange={(s) => {
        setSort(s);
        setPage(1);
      }}
      onFilterChange={(filters) => {
        const f = filters.isPlatformAdmin;
        setPlatformAdmin(f && f.length > 0 ? String(f[0]) : undefined);
        setPage(1);
      }}
      searchable
      onSearch={(value) => {
        setSearch(value);
        setPage(1);
      }}
      emptyText={
        <EmptyState
          actionLabel={t("createLogin")}
          actionVariant="outline"
          onAction={() => router.push(`/${locale}/admin/access/new`)}
        />
      }
    />
  );
}
