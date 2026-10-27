"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Download, Plus, Upload } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Input } from "@/components/ui/input";
import { DataTable, type SortChange } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { NativeSelect } from "@/components/org/NativeSelect";
import { CANDIDATE_SOURCES } from "@/lib/validations/hiring/candidate";
import { qs, useHiringMe, useHiringMutation, useHiringQuery } from "../ui/api";
import { BOARD_STEPS } from "@/lib/hiring/stage-rules";
import { useRequisitionOptions } from "../ui/requisition-options";
import { ScoreChip, StageBadge } from "../ui/stage";
import { QueryState } from "../ui/states";
import { AdvancedFilters, type AdvancedValues } from "./AdvancedFilters";
import { BulkBar } from "./BulkBar";
import { FilterChips } from "./FilterChips";
import { RowMenu } from "./RowMenu";
import { useStageMove } from "./useStageMove";
import { ViewSwitch } from "./ViewSwitch";

export type CandidateRow = {
  id: string;
  name: string;
  email: string | null;
  currentEmployer: string | null;
  stage: string;
  source: string;
  overallScore: number | null;
  createdAt: string;
  updatedAt: string;
  requisition: { id: string; title: string } | null;
};

const SEARCH_DEBOUNCE_MS = 300;

const daysSince = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

/** `/hiring/candidates` (Interview Hub `CandidatesListClient`). */
export function CandidateList({ initialStage }: { initialStage?: string }) {
  const t = useTranslations("hiring.candidates");
  const tStep = useTranslations("hiring.steps");
  const tsrc = useTranslations("hiring.source");
  const router = useRouter();
  const locale = useLocale();
  const { has } = useHiringMe();
  const canManage = has("hiring.manage");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Old `?stage=` links still filter by that stage; the chips filter by phase (UX P1-7).
  const [stage, setStage] = useState<string | undefined>(initialStage);
  const [phase, setPhase] = useState<string | undefined>(undefined);
  const [source, setSource] = useState("");
  const [requisitionId, setRequisitionId] = useState("");
  const [advanced, setAdvanced] = useState<AdvancedValues>({});
  const [sort, setSort] = useState<SortChange>({});
  const [selected, setSelected] = useState<string[]>([]);
  const { options: reqs } = useRequisitionOptions();
  const grades = useHiringQuery<{ code: string; name: string }[]>(
    canManage ? "/api/hiring/library/grades" : null,
  );
  const { move, dialog } = useStageMove();
  const shortlist = useHiringMutation<{ rid: string; action: "shortlist"; candidateIds: string[] }>(
    "POST",
    (b) => `/api/hiring/requisitions/${b.rid}/screening`,
    { success: t("shortlisted") },
  );

  useEffect(() => {
    const h = setTimeout(() => {
      if (searchInput.trim() !== search) {
        setSearch(searchInput.trim());
        setPage(1);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [searchInput, search]);

  const params = {
    page,
    pageSize,
    search,
    stage,
    phase,
    source,
    requisitionId,
    ...advanced,
    sort: sort.field,
    order: sort.order === "ascend" ? "asc" : sort.order === "descend" ? "desc" : undefined,
  };
  const { data, isLoading, error, refetch } = useHiringQuery<{
    data: CandidateRow[];
    total: number;
  }>(`/api/hiring/candidates${qs(params)}`);
  const reset = () => setPage(1);
  const profile = (id: string) => `/${locale}/hiring/candidates/${id}`;

  /** Shortlisting from the list walks screening (CV screened → shortlisted) for new applicants. */
  const doShortlist = (r: CandidateRow) => {
    if (r.requisition && (r.stage === "NEW_APPLICATION" || r.stage === "CV_SCREENED")) {
      shortlist.mutate({ rid: r.requisition.id, action: "shortlist", candidateIds: [r.id] });
    } else void move(r.id, "SHORTLISTED");
  };

  const columns = [
    {
      title: t("colCandidate"),
      key: "name",
      dataIndex: "name",
      sorter: true,
      render: (_: unknown, r: CandidateRow) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-8 w-8" aria-hidden>
            <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
              {r.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <Link
              href={profile(r.id)}
              className="block truncate font-semibold text-foreground hover:underline"
            >
              {r.name}
            </Link>
            <span className="block truncate text-xs text-muted-foreground">
              {r.currentEmployer
                ? t("fromEmployer", { employer: r.currentEmployer })
                : (r.email ?? "—")}
            </span>
          </div>
        </div>
      ),
    },
    {
      title: t("colRequisition"),
      key: "req",
      render: (_: unknown, r: CandidateRow) => (
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium">{r.requisition?.title ?? "—"}</span>
        </div>
      ),
    },
    {
      title: t("colStage"),
      key: "stage",
      dataIndex: "stage",
      sorter: true,
      render: (v: string) => <StageBadge stage={v} />,
    },
    {
      title: t("colFit"),
      key: "overallScore",
      dataIndex: "overallScore",
      sorter: true,
      align: "center" as const,
      render: (v: number | null) => <ScoreChip value={v} />,
    },
    {
      title: t("colSource"),
      key: "source",
      dataIndex: "source",
      sorter: true,
      render: (v: string) => <span className="text-sm text-muted-foreground">{tsrc(v)}</span>,
    },
    {
      title: t("colInStage"),
      key: "inStage",
      align: "right" as const,
      render: (_: unknown, r: CandidateRow) => {
        const d = daysSince(r.updatedAt);
        return (
          <span
            className={
              d > 5
                ? "font-mono text-xs font-semibold text-status-warn-fg"
                : "font-mono text-xs text-muted-foreground"
            }
          >
            {t("days", { days: d })}
          </span>
        );
      },
    },
    ...(canManage
      ? [
          {
            title: "",
            key: "actions",
            align: "right" as const,
            render: (_: unknown, r: CandidateRow) => (
              <RowMenu
                row={r}
                onShortlist={() => doShortlist(r)}
                onReject={() => void move(r.id, "REJECTED")}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle", { count: data?.total ?? 0 })}
        actions={
          <>
            <ViewSwitch active="list" />
            {canManage ? (
              <>
                <a
                  className={buttonVariants({ variant: "outline" })}
                  href={`/api/hiring/candidates/export${qs({ search, stage, phase, requisitionId })}`}
                >
                  <Download className="h-4 w-4" />
                  {t("export")}
                </a>
                <Button variant="outline" onClick={() => router.push(`/${locale}/hiring/import`)}>
                  <Upload className="h-4 w-4" />
                  {t("import")}
                </Button>
                <Button onClick={() => router.push(`/${locale}/hiring/candidates/new`)}>
                  <Plus className="h-4 w-4" />
                  {t("add")}
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          label={t("stageFilter")}
          active={phase}
          onSelect={(v) => {
            setPhase(v);
            setStage(undefined);
            reset();
          }}
          options={[
            { value: undefined, label: t("allStages") },
            ...BOARD_STEPS.map((s) => ({
              value: String(s) as string | undefined,
              label: tStep(String(s)),
            })),
          ]}
        />
        <span className="flex-1" />
        <Input
          className="w-56"
          aria-label={t("search")}
          placeholder={t("search")}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <NativeSelect
          aria-label={t("sourceFilter")}
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            reset();
          }}
        >
          <option value="">{t("allSources")}</option>
          {CANDIDATE_SOURCES.map((s) => (
            <option key={s} value={s}>
              {tsrc(s)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t("requisitionFilter")}
          className="max-w-56"
          value={requisitionId}
          onChange={(e) => {
            setRequisitionId(e.target.value);
            reset();
          }}
        >
          <option value="">{t("allRequisitions")}</option>
          {reqs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </NativeSelect>
        <AdvancedFilters
          value={advanced}
          onApply={(v) => {
            setAdvanced(v);
            reset();
          }}
          grades={grades.data ?? []}
          canFilterScore={has("hiring.viewPii")}
        />
      </div>
      {canManage && selected.length > 0 ? (
        <BulkBar ids={selected} onClear={() => setSelected([])} />
      ) : null}
      <QueryState isLoading={false} error={error} onRetry={() => void refetch()}>
        <DataTable<CandidateRow>
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
          onSortChange={setSort}
          rowSelection={
            canManage
              ? {
                  selectedRowKeys: selected,
                  onChange: (k) => setSelected(k.map(String)),
                  preserveSelectedRowKeys: true,
                }
              : undefined
          }
          emptyText={
            <EmptyState
              description={t("empty")}
              actionLabel={canManage ? t("add") : undefined}
              onAction={() => router.push(`/${locale}/hiring/candidates/new`)}
              actionVariant="outline"
            />
          }
        />
      </QueryState>
      {dialog}
    </div>
  );
}
