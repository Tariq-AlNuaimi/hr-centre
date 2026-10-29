"use client";

import { Suspense, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataTable } from "@/components/shared/DataTable";
import type { SortChange } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { FilterChips } from "@/components/shared/FilterBar";
import { DirectoryFilters, type DirectoryFilterValues } from "@/components/people/DirectoryFilters";
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
const FILTER_KEYS = [
  "entityId",
  "directorateId",
  "departmentId",
  "teamId",
  "managerId",
  "managerName",
  "roleTrack",
  "status",
] as const;
const STATUSES = ["ACTIVE", "PRE_JOINER", "LEAVER"] as const;

type DirectoryList = {
  data: EmployeeRecord[];
  total: number;
  statusCounts?: Record<string, number>;
};

export default function PeoplePage() {
  // useSearchParams needs a Suspense boundary under the App Router.
  return (
    <Suspense>
      <Directory />
    </Suspense>
  );
}

/**
 * UX review R11 — filters live in the URL (shareable, back-button safe) and
 * are applied server-side; salary is hidden until the viewer asks for it.
 */
function Directory() {
  const t = useTranslations("pms");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const locale = useLocale();
  const { capabilities } = usePmsActor();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortChange>({});
  const [showSalary, setShowSalary] = useState(false);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const filters = Object.fromEntries(
    FILTER_KEYS.map((k) => [k, searchParams.get(k) ?? ""]),
  ) as DirectoryFilterValues & { status: string };
  const setFilters = (next: Partial<typeof filters>) => {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    setPage(1);
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };
  const { status } = filters;
  const apiFilters = Object.fromEntries(
    FILTER_KEYS.filter((k) => k !== "managerName" && filters[k]).map((k) => [k, filters[k]]),
  );

  const params: Record<string, string> = {
    page: String(page),
    pageSize: String(pageSize),
    ...(search ? { search } : {}),
    ...(sort.field ? { sort: sort.field } : {}),
    ...(sort.order ? { order: sort.order === "ascend" ? "asc" : "desc" } : {}),
    ...apiFilters,
  };

  const { data: raw, isLoading } = useEntityList<EmployeeRecord>(
    "/api/employees",
    params,
    t("loadFailed"),
  );

  const data = raw as DirectoryList | undefined;
  const rows = data?.data ?? [];
  const counts = data?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const filtering = search !== "" || Object.keys(apiFilters).length > 0;
  const total = data?.total ?? 0;

  // Money formatting is locale-aware but currency-neutral: §11 never names a
  // currency, and inventing one would put a wrong symbol next to a real figure.
  const formatSalary = (value: string) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 3 }).format(
      Number(value),
    );

  const columns = getEmployeeColumns({
    showCompensation: capabilities.viewCompensation && showSalary,
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
        actions={<DirectoryActions />}
      />

      <DirectoryFilters value={filters} onChange={setFilters} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* §4.2 — counts are of the people THIS viewer may see; the subtitle
            says whose they are. */}
        <FilterChips
          label={t("status")}
          value={status}
          onChange={(value) => setFilters({ status: value })}
          chips={[
            { value: "", label: t("filter.allStatuses"), count: allCount },
            ...STATUSES.map((s) => ({
              value: s,
              label: t(`statusValue.${s}`),
              count: counts[s] ?? 0,
            })),
          ]}
        />
        {/* R11 — pay is not on screen by default (a projected or shared
            directory); entitled viewers turn the column on. */}
        {capabilities.viewCompensation ? (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={showSalary}
            onClick={() => setShowSalary((v) => !v)}
          >
            {showSalary ? t("directory.hideSalary") : t("directory.showSalary")}
          </Button>
        ) : null}
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
              filtering
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

/** HR Centre F-b — Add (typing is the second way in) and Import, for whoever may. */
function DirectoryActions() {
  const t = useTranslations("pms");
  const router = useRouter();
  const locale = useLocale();
  const { capabilities } = usePmsActor();
  if (!capabilities.previewImport && !capabilities.peopleEdit) return null;
  return (
    <div className="flex flex-wrap gap-2">
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
  );
}
