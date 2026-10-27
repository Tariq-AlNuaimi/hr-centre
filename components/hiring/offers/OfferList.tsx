"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Download, FileText, MailCheck, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { formatDate } from "@/lib/format";
import { OFFER_STATUSES } from "@/lib/hiring/offer-rules";
import { qs, useHiringMe, useHiringQuery } from "../ui/api";
import { QueryState } from "../ui/states";
import { LetterTemplateDialog } from "./LetterTemplateDialog";
import { OfferStatusBadge, omr } from "./bits";
import type { OfferListRow, OfferStatus } from "./types";
import { FilterChips } from "@/components/shared/FilterBar";

/** `/hiring/offers` (Interview Hub `OffersListClient`). Pay for comp readers only; the export never carries it. */
export function OfferList() {
  const t = useTranslations("hiring.offers");
  const ts = useTranslations("hiring.offerStatus");
  const router = useRouter();
  const locale = useLocale();
  const { has } = useHiringMe();
  const [status, setStatus] = useState<OfferStatus | "">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [template, setTemplate] = useState(false);
  const q = useHiringQuery<{ data: OfferListRow[]; total: number }>(
    `/api/hiring/offers${qs({ status, page, pageSize })}`,
  );
  const rows = q.data?.data ?? [];
  const total = q.data?.total ?? 0;
  const manage = has("hiring.manage");
  const columns = [
    {
      title: t("colCandidate"),
      key: "candidate",
      render: (_: unknown, r: OfferListRow) => (
        <Link className="font-semibold hover:underline" href={`/${locale}/hiring/offers/${r.id}`}>
          {r.candidate.name}
        </Link>
      ),
    },
    {
      title: t("colRequisition"),
      key: "requisition",
      render: (_: unknown, r: OfferListRow) => (
        <span className="text-muted-foreground">{r.requisition.title}</span>
      ),
    },
    {
      title: t("colBasic"),
      key: "basic",
      align: "right" as const,
      render: (_: unknown, r: OfferListRow) => <BasicCell row={r} />,
    },
    {
      title: t("colStatus"),
      key: "status",
      render: (_: unknown, r: OfferListRow) => <OfferStatusBadge status={r.status} />,
    },
    {
      title: t("colStart"),
      key: "start",
      render: (_: unknown, r: OfferListRow) => (r.startDate ? formatDate(r.startDate) : "—"),
    },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        subtitle={total ? t("subtitle", { count: total }) : undefined}
        actions={
          manage ? (
            <>
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/${locale}/hiring/close-out`}
              >
                <MailCheck className="h-4 w-4" />
                {t("closeOut")}
              </Link>
              <Button variant="outline" onClick={() => setTemplate(true)}>
                <FileText className="h-4 w-4" />
                {t("letterTemplate")}
              </Button>
              <a
                className={buttonVariants({ variant: "outline" })}
                href={`/api/hiring/offers/export${qs({ status })}`}
              >
                <Download className="h-4 w-4" />
                {t("export")}
              </a>
              <Button onClick={() => router.push(`/${locale}/hiring/offers/new`)}>
                <Plus className="h-4 w-4" />
                {t("create")}
              </Button>
            </>
          ) : null
        }
      />
      <FilterChips
        label={t("statusFilter")}
        value={status}
        onChange={(s) => {
          setStatus(s as OfferStatus | "");
          setPage(1);
        }}
        chips={[
          { value: "", label: t("all") },
          ...OFFER_STATUSES.map((s) => ({ value: s, label: ts(s) })),
        ]}
      />
      <QueryState isLoading={false} error={q.error} onRetry={() => void q.refetch()}>
        <DataTable<OfferListRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={q.isLoading}
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={(p, ps) => {
            setPage(p);
            setPageSize(ps);
          }}
          emptyText={
            <EmptyState
              description={status ? t("emptyFiltered") : t("empty")}
              actionLabel={manage ? t("create") : undefined}
              onAction={() => router.push(`/${locale}/hiring/offers/new`)}
              actionVariant="outline"
            />
          }
        />
      </QueryState>
      {template ? <LetterTemplateDialog onClose={() => setTemplate(false)} /> : null}
    </div>
  );
}

/** Basic pay for comp readers; "Restricted" otherwise; a COO-escalation marker. */
function BasicCell({ row }: { row: OfferListRow }) {
  const t = useTranslations("hiring.offers");
  if (row.compHidden) return <span className="text-muted-foreground">{t("restricted")}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono">
      {row.escalatesCoo ? (
        <TriangleAlert
          aria-label={t("cooEscalation")}
          className="h-3.5 w-3.5 text-status-warn-fg"
        />
      ) : null}
      {omr(row.salary)}
    </span>
  );
}
