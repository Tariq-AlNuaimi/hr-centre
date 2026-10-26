"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { DataTable } from "@/components/shared/DataTable";
import type { SortChange } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Button } from "@/components/ui/button";
import { getEmployeeColumns, type EmployeeRecord } from "@/components/pms/EmployeeColumns";
import { useEntityList } from "@/hooks/use-entity-queries";
import { usePmsActor } from "@/hooks/use-pms-actor";

/**
 * The employee directory — spec §4.2, §4.4 ("Oversight" view space), §4.5.
 *
 * List archetype: PageHeader → filters → DataTable.
 *
 * What this screen renders is decided by the SERVER: `/api/employees` scopes
 * rows to the actor's reporting chain and omits `basicSalary` unless they are
 * entitled to it. The capability read here only shapes affordances — showing a
 * permanently-empty salary column to a line manager would be noise, not a leak,
 * and hiding it is never what keeps the figure safe.
 */
export default function PeoplePage() {
  const t = useTranslations("pms");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const locale = useLocale();
  const { capabilities } = usePmsActor();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortChange>({});
  const [status, setStatus] = useState<string>("");

  const params: Record<string, string> = {
    page: String(page),
    pageSize: String(pageSize),
    ...(search ? { search } : {}),
    ...(sort.field ? { sort: sort.field } : {}),
    ...(sort.order ? { order: sort.order === "ascend" ? "asc" : "desc" } : {}),
    ...(status ? { status } : {}),
  };

  const { data, isLoading } = useEntityList<EmployeeRecord>(
    "/api/employees",
    params,
    t("loadFailed"),
  );

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  // Money formatting is locale-aware but currency-neutral: §11 never names a
  // currency, and inventing one would put a wrong symbol next to a real figure.
  const formatSalary = (value: string) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(
      Number(value),
    );

  const columns = getEmployeeColumns({
    showCompensation: capabilities.viewCompensation,
    locale,
    t,
    formatSalary,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("directory.title")}
        subtitle={
          capabilities.orgWide ? t("directory.subtitleOrgWide") : t("directory.subtitleChain")
        }
        actions={
          capabilities.previewImport || capabilities.peopleEdit ? (
            <div className="flex flex-wrap gap-2">
              {/* HR Centre F-b — typing is the second way in (blueprint §5). */}
              {capabilities.peopleEdit ? (
                <Button onClick={() => router.push(`/${locale}/people/new`)}>
                  {t("directory.addAction")}
                </Button>
              ) : null}
              {capabilities.previewImport ? (
                <Button
                  variant={capabilities.peopleEdit ? "outline" : "default"}
                  onClick={() => router.push(`/${locale}/admin/import`)}
                >
                  {t("directory.importAction")}
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />

      {/* §4.2 — say out loud whose people these are. A manager seeing 14 rows
          should know that is their chain, not the company. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title={t("directory.visibleCount")} value={total} icon={<Users />} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="status-filter" className="text-sm text-muted-foreground">
          {t("status")}
        </label>
        <select
          id="status-filter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">{t("filter.allStatuses")}</option>
          <option value="ACTIVE">{t("statusValue.ACTIVE")}</option>
          <option value="LEAVER">{t("statusValue.LEAVER")}</option>
          <option value="PRE_JOINER">{t("statusValue.PRE_JOINER")}</option>
        </select>
      </div>

      <DataTable<EmployeeRecord>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        total={total}
        page={page}
        pageSize={pageSize}
        searchable
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onPageChange={(nextPage, nextSize) => {
          setPage(nextPage);
          setPageSize(nextSize);
        }}
        onSortChange={setSort}
        emptyText={
          <EmptyState
            description={
              search || status
                ? tCommon("noResults")
                : capabilities.previewImport
                  ? t("directory.emptyHr")
                  : t("directory.emptyMember")
            }
            actionLabel={capabilities.previewImport ? t("directory.importAction") : undefined}
            onAction={
              capabilities.previewImport ? () => router.push(`/${locale}/admin/import`) : undefined
            }
            actionVariant="outline"
          />
        }
      />
    </div>
  );
}
