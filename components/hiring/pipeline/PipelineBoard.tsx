"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { BOARD_STEPS, stepEntryStage, type NextOwner } from "@/lib/hiring/stage-rules";
import { qs, useHiringQuery } from "../ui/api";
import { NationalityDot, ScoreChip } from "../ui/stage";
import { Notice, QueryState } from "../ui/states";
import { useStageMove } from "../candidates/useStageMove";
import type { BoardColumn } from "./BoardDnd";

const BoardDnd = dynamic(() => import("./BoardDnd").then((m) => m.BoardDnd), {
  ssr: false,
  loading: () => <BoardSkeleton />,
}) as typeof import("./BoardDnd").BoardDnd;

/**
 * The pipeline board (Interview Hub `PipelineBoard`): active candidates in the
 * seven candidate-bearing steps. A card waiting longer than seven days in its
 * stage is flagged. Dragging or the card's "Move to" menu moves the candidate
 * to the step's entry stage; the server's gates apply either way.
 */

export type BoardCard = {
  id: string;
  name: string;
  stage: string;
  requisitionTitle: string | null;
  overallScore: number | null;
  omani: boolean | null;
  hasOffer: boolean;
  nextOwner: NextOwner | null;
  step: number;
  inStageSince: string;
};

const SLA_DAYS = 7;
/** Whose move a card waits on (Greenhouse pattern, UX P1-8) — one colour each, with a legend. */
export const OWNER_DOT: Record<NextOwner, string> = {
  recruiter: "bg-status-info-fg",
  manager: "bg-primary",
  panel: "bg-status-warn-fg",
  candidate: "bg-status-neutral-fg",
  approvers: "bg-status-err-fg",
};
const ACCENT: Record<number, string> = {
  1: "bg-status-info-fg",
  2: "bg-status-info-fg",
  3: "bg-primary",
  4: "bg-primary",
  5: "bg-status-warn-fg",
  6: "bg-status-warn-fg",
  7: "bg-status-ok-fg",
};
const ROUND: Record<string, string> = {
  FIRST_INTERVIEW: "round1",
  SECOND_INTERVIEW: "round2",
  FINAL_INTERVIEW: "roundFinal",
};
const OFFER: Record<string, string> = {
  OFFER_DRAFTED: "offerDraft",
  OFFER_EXTENDED: "offerSent",
  OFFER_ACCEPTED: "offerAccepted",
};

const daysSince = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-72 w-68 shrink-0" />
      ))}
    </div>
  );
}

export function PipelineBoard({
  requisitionId,
  hiringManagerId,
  empty,
}: {
  requisitionId?: string;
  hiringManagerId?: string;
  empty: ReactNode;
}) {
  const t = useTranslations("hiring.pipeline");
  const tStep = useTranslations("hiring.steps");
  const { data, isLoading, error, refetch } = useHiringQuery<{
    cards: BoardCard[];
    truncated: boolean;
  }>(`/api/hiring/candidates/board${qs({ requisitionId, hiringManagerId })}`);
  const { move, dialog } = useStageMove();
  // Optimistic column while a move is in flight; the refetch settles it.
  const [moving, setMoving] = useState<Record<string, number>>({});
  const columns: BoardColumn[] = BOARD_STEPS.map((s) => ({
    id: String(s),
    title: tStep(String(s)),
    accent: ACCENT[s],
  }));
  const items = (data?.cards ?? []).map((c) => ({
    ...c,
    columnId: String(moving[c.id] ?? c.step),
  }));

  const moveTo = async (card: BoardCard, step: number) => {
    if (step === card.step) return;
    setMoving((m) => ({ ...m, [card.id]: step }));
    await move(card.id, stepEntryStage(step));
    setMoving((m) => {
      const next = { ...m };
      delete next[card.id];
      return next;
    });
  };

  return (
    <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()}>
      {items.length === 0 ? (
        empty
      ) : (
        <div className="space-y-3">
          {data?.truncated ? <Notice tone="warning">{t("truncated")}</Notice> : null}
          <OwnerLegend />
          <BoardDnd
            columns={columns}
            items={items}
            onMove={(item, to) => void moveTo(item, Number(to))}
            cardClass={(c) =>
              daysSince(c.inStageSince) > SLA_DAYS
                ? "border-s-4 border-s-status-warn-fg"
                : undefined
            }
            renderCard={(c) => <Card card={c} onMoveTo={(s) => void moveTo(c, s)} />}
          />
        </div>
      )}
      {dialog}
    </QueryState>
  );
}

function Card({ card, onMoveTo }: { card: BoardCard; onMoveTo: (step: number) => void }) {
  const t = useTranslations("hiring.pipeline");
  const tStep = useTranslations("hiring.steps");
  const locale = useLocale();
  const days = daysSince(card.inStageSince);
  const round = ROUND[card.stage];
  const offer = card.hasOffer ? OFFER[card.stage] : undefined;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Avatar className="h-8 w-8" aria-hidden>
          <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
            {initials(card.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <Link
            href={`/${locale}/hiring/candidates/${card.id}`}
            className="block truncate text-sm font-semibold text-foreground hover:underline"
          >
            {card.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {card.requisitionTitle ?? t("noRequisition")}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t("moveMenu", { name: card.name })}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t("moveTo")}</DropdownMenuLabel>
            {BOARD_STEPS.filter((s) => s !== card.step).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => onMoveTo(s)}>
                {tStep(String(s))}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ScoreChip value={card.overallScore} />
        {round ? <Badge variant="info">{t(round)}</Badge> : null}
        {offer ? <Badge variant="success">{t(offer)}</Badge> : null}
        <span className="flex-1" />
        {card.nextOwner ? <OwnerTag owner={card.nextOwner} /> : null}
        <NationalityDot omani={card.omani} />
        <span
          className={
            days > SLA_DAYS
              ? "font-mono text-xs font-semibold text-status-warn-fg"
              : "font-mono text-xs font-semibold text-muted-foreground"
          }
          title={t("daysInStage", { days })}
        >
          {t("days", { days })}
        </span>
      </div>
    </div>
  );
}

function OwnerTag({ owner }: { owner: NextOwner }) {
  const tOwner = useTranslations("hiring.pipeline.owner");
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span aria-hidden className={`h-2 w-2 rounded-full ${OWNER_DOT[owner]}`} />
      {tOwner(owner)}
    </span>
  );
}

function OwnerLegend() {
  const tOwner = useTranslations("hiring.pipeline.owner");
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{tOwner("legend")}</span>
      {(Object.keys(OWNER_DOT) as NextOwner[]).map((o) => (
        <span key={o} className="inline-flex items-center gap-1">
          <span aria-hidden className={`h-2 w-2 rounded-full ${OWNER_DOT[o]}`} />
          {tOwner(o)}
        </span>
      ))}
    </p>
  );
}
