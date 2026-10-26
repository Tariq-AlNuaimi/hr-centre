"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Bot, CheckCircle2, GitFork, Lock, Pencil, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { isHireVote, voteDivergence, type HireVote } from "@/lib/hiring/scorecard-math";
import { useHiringQuery } from "../ui/api";
import { useCrumb } from "../ui/crumb";
import { Notice, QueryState } from "../ui/states";
import { VoteBadge } from "../interviews/bits";
import { ReviseDialog } from "./ReviseDialog";
import type { ComparePayload, MyCard } from "./types";

type Row = {
  key: string;
  who: string;
  role: "you" | "ai" | "peer";
  vote: HireVote | null;
  scores: Record<string, number> | null;
};
type Revealed = Extract<ComparePayload, { locked: false }>;

/** What the stored transcript analysis says, read defensively (it is model output). */
function aiReading(output: unknown) {
  const o = (output ?? {}) as Record<string, unknown>;
  const text =
    typeof o.text === "string" ? o.text : typeof o.summary === "string" ? o.summary : null;
  const scores =
    o.scores && typeof o.scores === "object" ? (o.scores as Record<string, number>) : null;
  return { text, scores, vote: isHireVote(o.vote) ? o.vote : null };
}

/** `/hiring/panel/[id]/compare` (Interview Hub panel compare): my read beside the AI and the panel. */
export function PanelCompare({ id }: { id: string }) {
  const t = useTranslations("hiring.panel");
  const router = useRouter();
  const locale = useLocale();
  const q = useHiringQuery<ComparePayload>(`/api/hiring/panel/${id}/compare`);
  const brief = useHiringQuery<{ candidate: { name: string } }>(`/api/hiring/panel/${id}/brief`);
  useCrumb(id, brief.data?.candidate.name);
  const [revising, setRevising] = useState(false);
  const d = q.data;
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {d?.locked ? (
        <div className="mx-auto max-w-md rounded-md border border-border bg-card p-8 text-center">
          <Lock className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <h1 className="mt-4 text-lg font-semibold">{t("lockedTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {d.mode === "off" ? t("lockedOff") : t("lockedBlind")}
          </p>
          {d.mode !== "off" ? (
            <Button
              className="mt-4"
              onClick={() => router.push(`/${locale}/hiring/panel/${id}/score`)}
            >
              {t("goToScorecard")}
            </Button>
          ) : null}
        </div>
      ) : d ? (
        <div className="space-y-4">
          <PageHeader
            title={t("compareTitle")}
            subtitle={t("compareSubtitle")}
            actions={
              <>
                {d.mine?.submitted ? (
                  <Button variant="outline" onClick={() => setRevising(true)}>
                    <Pencil className="h-4 w-4" />
                    {t("revise")}
                  </Button>
                ) : null}
                <Button onClick={() => router.push(`/${locale}/hiring/panel`)}>
                  <CheckCircle2 className="h-4 w-4" />
                  {t("confirmJoin")}
                </Button>
              </>
            }
          />
          {d.mode === "assisted" ? (
            <Notice tone="warning" title={t("assistedTitle")}>
              {t("assistedBody")}
            </Notice>
          ) : null}
          <Revealed d={d} />
          {revising && d.mine ? (
            <ReviseDialog id={id} mine={d.mine} onClose={() => setRevising(false)} />
          ) : null}
        </div>
      ) : null}
    </QueryState>
  );
}

function Revealed({ d }: { d: Revealed }) {
  const t = useTranslations("hiring.panel");
  const tv = useTranslations("hiring.vote");
  const ai = aiReading(d.ai?.output);
  const mine = d.mine?.submitted ? d.mine : null;
  const rows: Row[] = [
    {
      key: "you",
      who: t("you"),
      role: "you",
      vote: mine?.vote ?? null,
      scores: mine?.scores ?? null,
    },
    ...(d.ai
      ? [{ key: "ai", who: t("aiPanelist"), role: "ai" as const, vote: ai.vote, scores: ai.scores }]
      : []),
    ...d.peers.map((p) => ({
      key: p.panelistId,
      who: p.name,
      role: "peer" as const,
      vote: p.vote,
      scores: p.scores,
    })),
  ];
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.scores ?? {})))];
  const div = voteDivergence(
    mine?.vote ?? null,
    d.peers.map((p) => p.vote),
    ai.vote,
  );
  const parts = [
    div.ai ? t("divergeAi", { vote: tv(div.ai) }) : null,
    div.panel?.kind === "majority" ? t("divergeMajority", { vote: tv(div.panel.vote) }) : null,
    div.panel?.kind === "one" ? t("divergeOne", { vote: tv(div.panel.vote) }) : null,
    div.panel?.kind === "split" ? t("divergeSplit") : null,
  ].filter((p): p is string => p !== null);
  return (
    <>
      <SectionCard title={t("comparisonTitle")} noBodyPadding>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 text-start font-semibold">
                  {t("evaluator")}
                </th>
                <th scope="col" className="px-4 py-2 text-start font-semibold">
                  {t("vote")}
                </th>
                {keys.map((k) => (
                  <th key={k} scope="col" className="px-4 py-2 text-center font-semibold">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className={
                    r.role === "you"
                      ? "border-b border-border bg-accent-subtle"
                      : "border-b border-border"
                  }
                >
                  <th scope="row" className="px-4 py-2 text-start font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      {r.role === "ai" ? <Bot className="h-4 w-4" aria-hidden /> : null}
                      <span className={r.role === "you" ? "font-semibold" : undefined}>
                        {r.who}
                      </span>
                    </span>
                  </th>
                  <td className="px-4 py-2">{r.vote ? <VoteBadge vote={r.vote} /> : "—"}</td>
                  {keys.map((k) => (
                    <td key={k} className="px-4 py-2 text-center font-mono">
                      {r.scores?.[k] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.peers.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">{t("noPeersYet")}</p>
        ) : null}
      </SectionCard>
      {parts.length && mine ? (
        <Notice tone="info" title={t("divergenceTitle")}>
          <span className="inline-flex gap-2">
            <GitFork className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t("divergenceBody", { vote: tv(mine.vote), who: parts.join(t("and")) })}
          </span>
        </Notice>
      ) : null}
      <div className="grid items-start gap-4 md:grid-cols-2">
        <SectionCard
          title={
            <span className="inline-flex items-center gap-1.5">
              <Bot className="h-4 w-4" aria-hidden />
              {t("aiTitle")}
            </span>
          }
          actions={<Badge variant="outline">{t("advisory")}</Badge>}
        >
          {ai.text ? (
            <p className="text-sm whitespace-pre-wrap">{ai.text}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noAi")}</p>
          )}
        </SectionCard>
        <MyLockedCard mine={d.mine} />
      </div>
    </>
  );
}

function MyLockedCard({ mine }: { mine: MyCard | null }) {
  const t = useTranslations("hiring.panel");
  const submitted = mine?.submitted ? mine : null;
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-4 w-4" aria-hidden />
          {t("myLocked")}
        </span>
      }
      actions={submitted ? <VoteBadge vote={submitted.vote} /> : null}
    >
      {submitted ? (
        <div className="space-y-2 text-sm">
          {Object.keys(submitted.scores ?? {}).length ? (
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {Object.entries(submitted.scores ?? {}).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt>{k}</dt>
                  <dd className="font-mono font-semibold">{t("outOfFive", { score: v })}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {submitted.strengths ? (
            <p>
              <span className="font-semibold">{t("strengthsLabel")}</span> {submitted.strengths}
            </p>
          ) : null}
          {submitted.concerns ? (
            <p>
              <span className="font-semibold">{t("concernsLabel")}</span> {submitted.concerns}
            </p>
          ) : null}
          {submitted.notes ? (
            <p>
              <span className="font-semibold">{t("notesLabel")}</span> {submitted.notes}
            </p>
          ) : null}
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
            {t("changesLogged")}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("notSubmittedYet")}</p>
      )}
    </SectionCard>
  );
}
