"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { formatDate } from "@/lib/format";
import { useHiringQuery } from "../ui/api";
import { useCrumb } from "../ui/crumb";
import { Notice, QueryState } from "../ui/states";
import { PipelineBoard, type BoardCard } from "../pipeline/PipelineBoard";
import { PhaseProgress } from "./PhaseProgress";
import type { RequisitionDetail } from "./types";

type Posting = { channel: string; live: boolean; postedAt: string | null };

/**
 * One requisition's candidates as a board (Interview Hub `/positions/[id]/pipeline`).
 * The empty state says WHY nothing is arriving: live on the careers page, live
 * elsewhere only, or not advertised at all.
 */
export function RequisitionPipeline({ id }: { id: string }) {
  const t = useTranslations("hiring.reqPipeline");
  const tc = useTranslations("hiring.posting");
  const router = useRouter();
  const locale = useLocale();
  const req = useHiringQuery<RequisitionDetail>(`/api/hiring/requisitions/${id}`);
  const posting = useHiringQuery<{ rows: Posting[] }>(`/api/hiring/requisitions/${id}/postings`);
  const board = useHiringQuery<{ cards: BoardCard[] }>(
    `/api/hiring/candidates/board?requisitionId=${id}`,
  );
  const live = (posting.data?.rows ?? []).filter((p) => p.live && p.postedAt);
  live.sort((a, b) => (a.postedAt ?? "").localeCompare(b.postedAt ?? ""));
  const careers = live.find((p) => p.channel === "CAREERS_PAGE");
  const channels = live.map((p) => tc(`channel.${p.channel}.label`)).join(", ");
  const cards = board.data?.cards ?? [];
  const base = `/${locale}/hiring`;
  useCrumb(id, req.data?.title);
  const empty = (
    <div className="rounded-md border border-border bg-card px-6 py-12 text-center">
      <p className="text-base font-semibold text-foreground">{t("emptyTitle")}</p>
      <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
        {careers
          ? t("emptyCareers", { date: formatDate(careers.postedAt!) })
          : live.length
            ? t("emptyOtherChannels", { channels })
            : t("emptyNotAdvertised")}
      </p>
    </div>
  );
  return (
    <QueryState isLoading={req.isLoading} error={req.error} onRetry={() => void req.refetch()}>
      {req.data ? (
        <div className="space-y-4">
          <PageHeader
            title={t("title")}
            subtitle={t("subtitle", {
              title: req.data.title,
              since: live[0]?.postedAt
                ? t("openSince", { date: formatDate(live[0].postedAt) })
                : t("notAdvertised"),
            })}
            actions={
              req.data.can.manage ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => router.push(`${base}/import?requisitionId=${id}`)}
                  >
                    <Upload className="h-4 w-4" />
                    {t("import")}
                  </Button>
                  <Button onClick={() => router.push(`${base}/candidates/new?requisitionId=${id}`)}>
                    <Plus className="h-4 w-4" />
                    {t("add")}
                  </Button>
                </>
              ) : null
            }
          />
          <PhaseProgress steps={cards.map((c) => c.step)} />
          <PipelineBoard requisitionId={id} empty={empty} />
          <Notice tone="info">
            {careers ? t("careersLive", { date: formatDate(careers.postedAt!) }) : t("careersOff")}{" "}
            <Link href={`${base}/requisitions/${id}/posting`} className="font-medium underline">
              {t("postingLink")}
            </Link>
          </Notice>
        </div>
      ) : null}
    </QueryState>
  );
}
