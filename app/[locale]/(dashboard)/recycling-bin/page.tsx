"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useNotify } from "@/hooks/use-notify";
import { useSession } from "next-auth/react";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { DataTable } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

function RestoreIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </svg>
  );
}

interface DeletedItem {
  entityType: string;
  id: string;
  displayName: string;
  deletedAt: string;
  deletedBy: string | null;
}

// Envelope returned by the paginated GET /api/recycling-bin.
interface RecyclingBinResponse {
  data: DeletedItem[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 20;

export default function RecyclingBinPage() {
  const t = useTranslations("recyclingBin");
  const tCommon = useTranslations("common");
  const { success, error: showError } = useNotify();
  const { data: session } = useSession();
  // types/index.ts augments next-auth's Session.user with role: Role,
  // so this access is typed -- no `as any` needed.
  const isAdmin = session?.user?.role === "ADMIN";

  const [items, setItems] = useState<DeletedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);

  // Monotonic request token — same race as the audit log: rapid page/page-size
  // clicks fire overlapping requests, and a slow earlier response could
  // overwrite a fast later one, showing the wrong page right before a
  // restore/purge decision. Only the newest request commits state.
  // (2026-07-25 review.)
  const requestSeq = useRef(0);

  const fetchItems = useCallback(
    async (nextPage: number, nextPageSize: number) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          page: String(nextPage),
          pageSize: String(nextPageSize),
        }).toString();
        // apiClient unwraps the `ApiResponse` envelope, so this is the inner
        // paginated payload (`{ data, total, page, pageSize }`).
        const res = await apiClient.get<RecyclingBinResponse>(`/api/recycling-bin?${qs}`);
        if (seq !== requestSeq.current) return; // superseded — drop this response
        setItems(res.data ?? []);
        setTotal(res.total ?? 0);
        setPage(res.page ?? nextPage);
        setPageSize(res.pageSize ?? nextPageSize);
      } catch {
        if (seq !== requestSeq.current) return;
        showError(t("loadFailed"));
      } finally {
        // Only the newest request owns the spinner.
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [showError, t],
  );

  useEffect(() => {
    // Initial data load: fetchItems() sets loading state synchronously (intended
    // spinner UX on mount), which react-hooks/set-state-in-effect flags — the
    // documented fetch-in-effect pattern, not a cascading render bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchItems(page, pageSize);
    // Initial load only; subsequent loads go through handlers below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePageChange = (nextPage: number, nextPageSize: number) => {
    fetchItems(nextPage, nextPageSize);
  };

  const handleRestore = async (item: DeletedItem) => {
    try {
      await apiClient.post("/api/recycling-bin", {
        entityType: item.entityType,
        id: item.id,
      });
      success(t("restored", { name: item.displayName }));
      fetchItems(page, pageSize);
    } catch {
      showError(t("restoreFailed"));
    }
  };

  const handlePermanentDelete = async (item: DeletedItem) => {
    try {
      await apiClient.delete(`/api/recycling-bin/${item.entityType}/${item.id}`);
      success(t("permanentlyDeleted", { name: item.displayName }));
      fetchItems(page, pageSize);
    } catch {
      showError(t("deleteFailed"));
    }
  };

  const columns = [
    {
      title: t("entityType"),
      dataIndex: "entityType",
      key: "entityType",
      render: (val: string) => <Badge>{val}</Badge>,
    },
    {
      title: t("name"),
      dataIndex: "displayName",
      key: "displayName",
    },
    {
      title: t("deletedAt"),
      dataIndex: "deletedAt",
      key: "deletedAt",
      render: (val: string) => formatDateTime(val),
    },
    {
      title: t("deletedBy"),
      dataIndex: "deletedBy",
      key: "deletedBy",
      render: (val: string | null) => val ?? "-",
    },
    {
      title: tCommon("actions"),
      key: "actions",
      render: (_: unknown, record: DeletedItem) =>
        // Restore + permanent delete are both ADMIN-only (POST/DELETE are
        // withAdminAuth); don't show buttons that would 403 for non-admins.
        isAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label={t("restoreAction")}
              onClick={() => handleRestore(record)}
            >
              <RestoreIcon />
              {t("restore")}
            </Button>
            <ConfirmAction
              title={t("permanentDeleteConfirm")}
              okType="danger"
              okText={t("permanentDelete")}
              cancelText={tCommon("cancel")}
              onConfirm={() => handlePermanentDelete(record)}
            >
              <Button variant="destructive" size="sm" aria-label={t("permanentDeleteAction")}>
                <TrashIcon />
                {t("permanentDelete")}
              </Button>
            </ConfirmAction>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={t("title")} />
      <DataTable<DeletedItem>
        dataSource={items}
        columns={columns}
        loading={loading}
        rowKey={(r) => `${r.entityType}-${r.id}`}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={handlePageChange}
        emptyText={t("empty")}
      />
    </>
  );
}
