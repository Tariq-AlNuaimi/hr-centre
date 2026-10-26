"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ChevronRight, Download, Plus, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { formatDate } from "@/lib/format";
import { HIRE_VOTES, type HireVote } from "@/lib/hiring/scorecard-math";
import { qs, useHiringMutation, useHiringQuery } from "../ui/api";
import { QueryState } from "../ui/states";
import { FilterChips } from "../candidates/FilterChips";
import { VoteBadge, initials, useRoundLabel } from "../interviews/bits";

type EvaluationRow = {
  id: string;
  vote: HireVote | null;
  submitted: boolean;
  submittedAt: string | null;
  createdAt: string;
  candidate: { id: string; name: string };
  panelist: { id: string; name: string } | null;
  interview: { id: string; round: string; scheduledDate: string; requisition: { title: string } };
};

const PAGE_SIZE = 20;

/** `/hiring/evaluations` (Interview Hub `EvaluationsListClient`): every scorecard HR manages. */
export function EvaluationList() {
  const t = useTranslations("hiring.evaluations");
  const tv = useTranslations("hiring.vote");
  const router = useRouter();
  const locale = useLocale();
  const roundLabel = useRoundLabel();
  const [vote, setVote] = useState<HireVote | "">("");
  const [page, setPage] = useState(1);
  const q = useHiringQuery<{ data: EvaluationRow[]; total: number }>(
    `/api/hiring/evaluations${qs({ page, pageSize: PAGE_SIZE, vote })}`,
  );
  const remove = useHiringMutation<{ id: string }>(
    "DELETE",
    (b) => `/api/hiring/evaluations/${b.id}`,
    { success: t("deleted") },
  );
  const rows = q.data?.data ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const create = () => router.push(`/${locale}/hiring/evaluations/new`);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={total ? t("subtitle", { count: total }) : undefined}
        actions={
          <>
            <a
              className={buttonVariants({ variant: "outline" })}
              href={`/api/hiring/evaluations/export${qs({ vote })}`}
            >
              <Download className="h-4 w-4" />
              {t("export")}
            </a>
            <Button onClick={create}>
              <Plus className="h-4 w-4" />
              {t("create")}
            </Button>
          </>
        }
      />
      <FilterChips
        label={t("voteFilter")}
        active={vote}
        onSelect={(v) => {
          setVote(v);
          setPage(1);
        }}
        options={[
          { value: "" as const, label: t("all") },
          ...HIRE_VOTES.map((v) => ({ value: v, label: tv(v) })),
        ]}
      />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {rows.length === 0 ? (
          <EmptyState
            description={vote ? t("emptyFiltered") : t("empty")}
            actionLabel={t("create")}
            onAction={create}
            actionVariant="outline"
          />
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card p-4"
              >
                <Avatar className="h-11 w-11" aria-hidden>
                  <AvatarFallback>{initials(r.candidate.name)}</AvatarFallback>
                </Avatar>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-start"
                  onClick={() => router.push(`/${locale}/hiring/evaluations/${r.id}`)}
                >
                  <span className="block font-semibold">{r.candidate.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {[
                      r.panelist?.name ?? t("unknownPanelist"),
                      roundLabel(r.interview.round),
                      r.interview.requisition.title,
                      formatDate(r.interview.scheduledDate),
                    ].join(" · ")}
                  </span>
                </button>
                <Badge variant={r.submitted ? "success" : "outline"}>
                  {r.submitted ? t("submitted") : t("draft")}
                </Badge>
                {r.vote ? <VoteBadge vote={r.vote} /> : null}
                <ConfirmAction
                  title={t("deleteConfirm")}
                  description={t("deleteHint")}
                  onConfirm={() => remove.mutate({ id: r.id })}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("deleteFor", { name: r.candidate.name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </ConfirmAction>
                <ChevronRight
                  className="h-4 w-4 text-muted-foreground rtl:rotate-180"
                  aria-hidden
                />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      {pages > 1 ? (
        <nav aria-label={t("pagination")} className="flex items-center justify-end gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t("previous")}
          </Button>
          <span>{t("pageOf", { page, pages })}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t("next")}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
