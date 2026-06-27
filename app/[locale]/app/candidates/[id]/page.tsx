import { getTranslations, getFormatter } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Info,
  FileDown,
  Clock4,
  AlertTriangle,
  Hourglass,
  PlugZap,
} from "lucide-react";
import { requireSession } from "@/lib/authz";
import { Link } from "@/i18n/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { computeResult, type ResultView } from "@/lib/services/result";
import type { ComputeOutcome } from "@/lib/services/result";
import { FitRing } from "./FitRing";
import { CompetencyRadar } from "./CompetencyRadar";
import { CompetencyBreakdown } from "./CompetencyBreakdown";
import { TraitDetail } from "./TraitDetail";
import { NarrativeBlock } from "./NarrativeBlock";
import { DecisionBlock } from "./DecisionBlock";
import { ComputeButton } from "./ComputeButton";

// Result evidence trail (UI-SPEC D.7) — the product's signature surface. RSC:
// lazily compute-on-view + persist via computeResult, then switch on the typed
// outcome. Every non-ok state is a calm, specific card (never a 500 / green panel).
// Manager-readable (requireSession = HR_ADMIN or HIRING_MANAGER).
export default async function ResultPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const session = await requireSession(locale);
  const orgId = session.user.orgId;
  if (!orgId) notFound();

  const t = await getTranslations("results");

  const outcome: ComputeOutcome = await computeResult(orgId, id);

  if (outcome.kind === "not-found") notFound();

  if (outcome.kind === "ok") {
    return <EvidenceTrail view={outcome.result} />;
  }

  // Calm, specific non-ok states (UI-SPEC D.7).
  return (
    <div>
      <BackLink label={t("backToCandidates")} />
      {outcome.kind === "not-submitted" && (
        <StateCard
          icon={Hourglass}
          title={t("stateNotSubmittedTitle")}
          body={t("stateNotSubmittedBody")}
        />
      )}
      {outcome.kind === "incomplete" && (
        <StateCard
          icon={AlertTriangle}
          title={t("stateIncompleteTitle")}
          body={t("stateIncompleteBody", { have: outcome.have, need: outcome.need })}
        />
      )}
      {outcome.kind === "no-active-profile" && (
        <StateCard
          icon={AlertTriangle}
          title={t("stateNoProfileTitle")}
          body={t("stateNoProfileBody")}
        />
      )}
      {outcome.kind === "scoring-not-configured" && (
        <StateCard
          icon={PlugZap}
          title={t("stateNotConfiguredTitle")}
          body={t("stateNotConfiguredBody")}
        />
      )}
      {outcome.kind === "scoring-unreachable" && (
        <StateCard
          icon={PlugZap}
          title={t("stateUnreachableTitle")}
          body={t("stateUnreachableBody")}
        >
          <ComputeButton assessmentId={id} mode="retry" />
        </StateCard>
      )}
    </div>
  );
}

async function EvidenceTrail({ view }: { view: ResultView }) {
  const t = await getTranslations("results");
  const tDomains = await getTranslations("results.domains");
  const tBands = await getTranslations("results.bands");
  const format = await getFormatter();

  const displayName = view.candidateName ?? view.candidateEmail;
  const radarData = view.scores.competencyScores.map((c) => ({
    competency: c.name,
    candidate: c.score,
    target: c.targetPercentile,
  }));
  const domainLabels: Record<string, string> = {
    OPENNESS: tDomains("OPENNESS"),
    CONSCIENTIOUSNESS: tDomains("CONSCIENTIOUSNESS"),
    EXTRAVERSION: tDomains("EXTRAVERSION"),
    AGREEABLENESS: tDomains("AGREEABLENESS"),
    NEUROTICISM: tDomains("NEUROTICISM"),
  };
  const bandLabels = {
    PASS: tBands("PASS"),
    PARTIAL: tBands("PARTIAL"),
    BELOW: tBands("BELOW"),
  } as const;
  const sjt = view.scores.sjtScores;

  return (
    <div className="flex flex-col gap-6">
      <BackLink label={t("backToCandidates")} />

      {/* (1) Header — identity, role, fit ring, community chip, actions */}
      <Card>
        <CardContent className="flex flex-col gap-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <FitRing fit={view.fitScore} label={t("fitTitle")} />
            <div className="flex flex-col gap-1.5">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                {displayName}
              </h1>
              {view.candidateName && (
                <span className="text-sm text-muted-foreground">{view.candidateEmail}</span>
              )}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span className="text-foreground">{view.roleTitle}</span>
                <span className="tabular-nums">
                  {t("roleVersion", { version: view.roleProfileVersion })}
                </span>
                <span>· {view.roleFamily}</span>
              </div>
              {view.completedAt && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock4 aria-hidden className="size-3.5" />
                  {t("completedOn", {
                    date: format.dateTime(view.completedAt, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    }),
                  })}
                </span>
              )}
              <p className="max-w-md text-xs text-muted-foreground">{t("fitCaption")}</p>
              {view.communityPercentile !== null && (
                <span
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--rihal-sand)]/40 bg-[var(--rihal-sand)]/10 px-2.5 py-0.5 text-xs text-foreground"
                  title={t("communityTooltip")}
                >
                  <Info aria-hidden className="size-3 text-[var(--rihal-sand)]" />
                  {t("communityChip", { pct: view.communityPercentile })}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <Button asChild variant="outline" size="sm">
              <a href={`/api/results/${view.resultId}/pdf`} target="_blank" rel="noopener">
                <FileDown className="size-4" />
                {t("exportPdf")}
              </a>
            </Button>
            <ComputeButton assessmentId={view.assessmentId} mode="recompute" />
            <Link
              href="/methodology"
              className="text-xs text-accent-ink underline-offset-4 hover:underline"
            >
              {t("methodologyLink")}
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* (2) Competency radar */}
      <Card>
        <CardHeader>
          <CardTitle>{t("radarTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("radarSubtitle")}</p>
        </CardHeader>
        <CardContent>
          <CompetencyRadar
            data={radarData}
            candidateLabel={t("seriesCandidate")}
            targetLabel={t("seriesTarget")}
          />
        </CardContent>
      </Card>

      {/* (3) Competency breakdown — the evidence trail */}
      <CompetencyBreakdown
        competencies={view.scores.competencyScores}
        bandLabels={bandLabels}
      />

      {/* (4) Trait detail (Big Five) */}
      <TraitDetail
        domains={view.scores.domainScores}
        facets={view.scores.facetScores}
        domainLabels={domainLabels}
      />

      {/* (5) Situational judgement */}
      <Card>
        <CardHeader>
          <CardTitle>{t("sjtTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("sjtSubtitle")}</p>
        </CardHeader>
        <CardContent>
          {sjt.total === 0 ? (
            <p className="text-sm text-muted-foreground">{t("sjtNone")}</p>
          ) : (
            <div className="flex items-center gap-4">
              <span className="font-display text-3xl font-semibold tabular-nums text-foreground">
                {sjt.overall === null ? "—" : sjt.overall}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{t("sjtOverall")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("sjtAnswered", { answered: sjt.answered, total: sjt.total })}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* (6) AI narrative */}
      <NarrativeBlock
        resultId={view.resultId}
        narrative={view.narrative}
        narrativeModel={view.narrativeModel}
      />

      {/* (7) Decision */}
      <DecisionBlock
        resultId={view.resultId}
        decision={view.decision}
        decisionNote={view.decisionNote}
        decidedByName={view.decidedByName}
        decidedAt={view.decidedAt}
      />
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/app/candidates"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
    >
      <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
      {label}
    </Link>
  );
}

function StateCard({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: typeof Info;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="mt-4 flex flex-col items-center gap-4 px-6 py-16 text-center">
      <span className="rounded-xl bg-secondary p-3 text-accent">
        <Icon className="size-6" />
      </span>
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      </div>
      {children}
    </Card>
  );
}
