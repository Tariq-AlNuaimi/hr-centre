"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionCard } from "@/components/shared/SectionCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CyclePicker } from "@/components/pms/CyclePicker";
import { useCycleSelection } from "@/hooks/use-cycle-selection";
import { ApiError, apiClient } from "@/lib/api-client";

/**
 * §9.8 — "Generate individual 360 reports."
 *
 * ## Why this exists
 *
 * `GET /api/three-sixty/results` had no caller: the consolidated per-employee
 * 360 was assembled and unreachable (`docs/verification/SPEC-REDTEAM.md`, F6).
 *
 * ## Why it lives HERE and not on the 360 console
 *
 * The 360 console's own header states the rule: "a screen that pairs *who was
 * assigned* (which HR must see, §9.4) with *what came back* is the join that
 * defeats [§13.1's anonymity]". So the report deliberately does not go there.
 * It goes on the person's record, which is where §13.6 already sends HR and the
 * executive viewers for "full drill-down on demand into any individual's
 * complete record". The assignment map and the results stay on separate screens,
 * and no screen shows both.
 *
 * Comments arrive already unattributed and already shuffled by question — the
 * route strips every rater and assignment id before they leave the server, so
 * there is nothing here to protect that was not protected upstream.
 *
 * ## The rater count is shown, and that is the point
 *
 * §9.5 averages "the 3 ratios". When fewer arrive the average is taken over what
 * exists — defensible, but invisible everywhere else in the product (red-team
 * F8). Here the count is stated next to the figure, so a 360 built from one
 * rater cannot be mistaken for one built from three.
 */

interface ThreeSixtyResult {
  employeeId: string;
  name: string;
  /** §9.4's raters: SUBMITTED forms, whatever they contained. */
  assessmentCount: number;
  /** How many of those contributed a ratio to §9.5's average. */
  ratedCount: number;
  ratio: string | null;
  levelEquivalent: string | null;
  /**
   * `question` is null when this comment stands alone under it, and there is no
   * position either — both would name its author (§13.1). Order is the route's.
   */
  comments: { question: string | null; text: string }[];
}

/** §9.4 — "Raters — exactly 3 per employee". */
const EXPECTED_RATERS = 3;

/**
 * §9.5's ratio arrives as a Decimal string — 0.91666666666666666667 for eleven
 * twelfths. Twenty decimal places is precision nobody reads and nobody needs:
 * the figure that carries into §8.5 is `levelEquivalent`, and this is the
 * supporting fraction. Three places is enough to tell two ratios apart.
 */
function shortRatio(ratio: string | null): string {
  const n = Number(ratio);
  return ratio !== null && Number.isFinite(n) ? n.toFixed(3) : "—";
}

/**
 * §9.8 — "Consolidate written comments per employee."
 *
 * Consolidated means grouped by the question that was asked, not listed as
 * three separate answers each repeating the same heading. It also happens to be
 * the safer shape: a reader scanning a flat list can count entries and infer
 * how many raters left a comment on that question, which is a step towards
 * §13.1's anonymity being unpicked. Under one heading, the texts are just
 * texts.
 */
function groupByQuestion(comments: { question: string | null; text: string }[]) {
  const groups: { question: string | null; texts: string[] }[] = [];
  const byQuestion = new Map<string, { question: string | null; texts: string[] }>();
  for (const c of comments) {
    // The route sends `null` for a comment that stands alone under its question
    // (§13.1), and no position either. Those get their own entry rather than
    // being heaped together under one anonymous heading. Order is the route's.
    if (c.question === null) {
      groups.push({ question: null, texts: [c.text] });
      continue;
    }
    const existing = byQuestion.get(c.question);
    if (existing) {
      existing.texts.push(c.text);
      continue;
    }
    const group = { question: c.question, texts: [c.text] };
    byQuestion.set(c.question, group);
    groups.push(group);
  }
  return groups;
}

/**
 * Which of the card's five states applies.
 *
 * Lifted out of the component because the distinctions are the substance, not
 * plumbing: a request that FAILED must never render as "nothing was submitted"
 * (an absence a reader would act on), and a 404 on the cycle read is an absence
 * rather than a failure. A disabled react-query reports `isLoading === false`,
 * so "still loading" has to include the cycle LIST being in flight — otherwise
 * the empty state flashes and then contradicts itself.
 */
type CardState = "loading" | "failed" | "noCycle" | "noResult" | "ready";

function cardState(q: {
  cyclesLoading: boolean;
  cyclesError: boolean;
  cycleId: string | null;
  cycleLoading: boolean;
  cycleError: unknown;
  threeSixtyId: string | null;
  resultsLoading: boolean;
  resultsError: boolean;
  submitted: boolean;
}): CardState {
  if (q.cyclesLoading || (q.cycleId !== null && q.cycleLoading)) return "loading";
  const missing = q.cycleError instanceof ApiError && q.cycleError.status === 404;
  // A failed cycle LIST leaves an empty list, which would otherwise read as
  // "this year has no 360" — a failure dressed as an absence.
  if (q.cyclesError || (q.cycleError && !missing) || q.resultsError) return "failed";
  if (q.threeSixtyId === null) return "noCycle";
  if (q.resultsLoading) return "loading";
  return q.submitted ? "ready" : "noResult";
}

export function ThreeSixtyResultCard({ employeeId }: { employeeId: string }) {
  const t = useTranslations("pms.threeSixtyResult");
  const { cycles, cycleList, cycleId, selectedCycleId, setSelectedCycleId } = useCycleSelection();

  const cycle = useQuery({
    queryKey: ["pms", "360", cycleId],
    queryFn: () =>
      apiClient.get<{ threeSixty: { id: string; status: string } | null }>(
        `/api/three-sixty?cycleId=${cycleId}`,
      ),
    enabled: cycleId !== null,
    // A performance year with no 360 answers 404, which is an absence rather
    // than a failure — retrying it just delays the empty state.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });

  const threeSixtyId = cycle.data?.threeSixty?.id ?? null;

  const results = useQuery({
    queryKey: ["pms", "360", "results", threeSixtyId, employeeId],
    queryFn: () =>
      apiClient.get<{ results: ThreeSixtyResult[] }>(
        `/api/three-sixty/results?threeSixtyCycleId=${threeSixtyId}&employeeId=${employeeId}`,
      ),
    enabled: threeSixtyId !== null,
  });

  const result = results.data?.results?.[0] ?? null;
  const state = cardState({
    cyclesLoading: cycles.isLoading,
    cyclesError: cycles.isError,
    cycleId,
    cycleLoading: cycle.isLoading,
    cycleError: cycle.error,
    threeSixtyId,
    resultsLoading: results.isLoading,
    resultsError: results.isError,
    // §9.5's ratio is null whenever no scored answer contributed — a template
    // of nothing but open-ended questions does that, and the create schema
    // allows one. Submitted IS the test; the figures say "—" when there are
    // none, rather than the whole report claiming nothing arrived.
    submitted: result !== null && result.assessmentCount > 0,
  });

  return (
    <SectionCard
      title={t("title")}
      subtitle={t("help")}
      actions={
        // §13.6's drill-down is not only into the live year. Without this the
        // card is pinned to whichever cycle is OPEN, and January's new cycle
        // would put last year's 360 permanently out of reach.
        <CyclePicker
          cycles={cycleList}
          value={selectedCycleId ?? cycleId}
          onChange={setSelectedCycleId}
        />
      }
    >
      {state === "loading" ? (
        // A skeleton rather than an unmount: the picker lives in this card's
        // header, so returning null would make the control the reader just used
        // disappear — and take keyboard focus with it — for two round-trips.
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-11 w-20" />
            <Skeleton className="h-6 w-40 self-center" />
          </div>
          <Skeleton className="h-20 w-full" />
        </div>
      ) : state === "failed" ? (
        <EmptyState description={t("loadFailed")} />
      ) : state === "noCycle" ? (
        <EmptyState description={t("noCycle")} />
      ) : state !== "ready" || result === null ? (
        // Nothing submitted yet is not the same as a low score, and §9.7's
        // status tracking is where "who has not answered" belongs.
        <EmptyState description={t("noResult")} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("score")}</p>
              <p className="text-2xl font-semibold">{result.levelEquivalent ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("ratio")}</p>
              <p className="text-sm tabular-nums">{shortRatio(result.ratio)}</p>
            </div>
            {/* F8's fix, at the one place the figure is read: a 360 averaged
                over fewer than three raters says so. */}
            <Badge
              className="self-center"
              variant={result.assessmentCount >= EXPECTED_RATERS ? "success" : "warning"}
            >
              {t("raterCount", { count: result.assessmentCount, expected: EXPECTED_RATERS })}
            </Badge>
          </div>

          {result.ratio !== null && result.ratedCount < EXPECTED_RATERS && (
            <p className="max-w-prose text-sm text-destructive-emphasis">
              {t("shortWarning", { count: result.ratedCount, expected: EXPECTED_RATERS })}
            </p>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">{t("comments")}</p>
            {result.comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noComments")}</p>
            ) : (
              <ul className="space-y-2">
                {groupByQuestion(result.comments).map((group, groupIndex) => (
                  <li key={groupIndex} className="rounded-md border border-border p-3">
                    {/* Null when the route withheld the label because this
                        comment stands alone under its question (§13.1). */}
                    {group.question !== null && (
                      <p className="text-xs text-muted-foreground">{group.question}</p>
                    )}
                    <ul className="mt-1 space-y-2">
                      {group.texts.map((text, i) => (
                        <li key={i} className="text-sm">
                          {text}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t("anonymityNote")}</p>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
