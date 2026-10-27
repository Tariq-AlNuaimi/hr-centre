"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Download, FileText, MailCheck, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { formatDate } from "@/lib/format";
import { OFFER_STATUSES } from "@/lib/hiring/offer-rules";
import { qs, useHiringMe, useHiringQuery } from "../ui/api";
import { QueryState } from "../ui/states";
import { FilterChips } from "../candidates/FilterChips";
import { LetterTemplateDialog } from "./LetterTemplateDialog";
import { OfferStatusBadge, omr } from "./bits";
import type { OfferListRow, OfferStatus } from "./types";

const PAGE_SIZE = 20;

/** `/hiring/offers` (Interview Hub `OffersListClient`). Pay for comp readers only; the export never carries it. */
export function OfferList() {
  const t = useTranslations("hiring.offers");
  const ts = useTranslations("hiring.offerStatus");
  const router = useRouter();
  const locale = useLocale();
  const { has } = useHiringMe();
  const [status, setStatus] = useState<OfferStatus | "">("");
  const [page, setPage] = useState(1);
  const [template, setTemplate] = useState(false);
  const q = useHiringQuery<{ data: OfferListRow[]; total: number }>(
    `/api/hiring/offers${qs({ status, page, pageSize: PAGE_SIZE })}`,
  );
  const rows = q.data?.data ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const manage = has("hiring.manage");
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
        active={status}
        onSelect={(s) => {
          setStatus(s);
          setPage(1);
        }}
        options={[
          { value: "" as const, label: t("all") },
          ...OFFER_STATUSES.map((s) => ({ value: s, label: ts(s) })),
        ]}
      />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {rows.length === 0 ? (
          <EmptyState
            description={status ? t("emptyFiltered") : t("empty")}
            actionLabel={manage ? t("create") : undefined}
            onAction={() => router.push(`/${locale}/hiring/offers/new`)}
            actionVariant="outline"
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-start text-muted-foreground">
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t("colCandidate")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t("colRequisition")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">
                    {t("colBasic")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t("colStatus")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t("colStart")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted">
                    <td className="px-4 py-2">
                      <Link
                        className="font-semibold hover:underline"
                        href={`/${locale}/hiring/offers/${r.id}`}
                      >
                        {r.candidate.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{r.requisition.title}</td>
                    <td className="px-4 py-2 text-end font-mono">
                      {r.compHidden ? (
                        <span className="text-muted-foreground">{t("restricted")}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          {r.escalatesCoo ? (
                            <TriangleAlert
                              aria-label={t("cooEscalation")}
                              className="h-3.5 w-3.5 text-status-warn-fg"
                            />
                          ) : null}
                          {omr(r.salary)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <OfferStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2">{formatDate(r.startDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      {template ? <LetterTemplateDialog onClose={() => setTemplate(false)} /> : null}
    </div>
  );
}
