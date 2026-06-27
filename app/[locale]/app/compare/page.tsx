import { getTranslations } from "next-intl/server";
import { Columns3, AlertTriangle, Info } from "lucide-react";
import { requireSession } from "@/lib/authz";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { getCompareData, type CompareOutcome } from "@/lib/services/result";
import { BandPill } from "../candidates/[id]/BandPill";
import { CompareRadar } from "./CompareRadar";

// Compare (UI-SPEC D.8). RSC; reads ?ids= (comma list), single role, cap 6. Band-
// colored grid (candidates as columns, fit + each competency as rows). Honest
// too-few / too-many / cross-role / not-found states. Manager-readable.
export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ids?: string }>;
}) {
  const { locale } = await params;
  const { ids: idsParam } = await searchParams;
  const session = await requireSession(locale);
  const orgId = session.user.orgId;

  const t = await getTranslations("compare");
  const tBands = await getTranslations("results.bands");

  const ids = (idsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const outcome: CompareOutcome =
    orgId && ids.length > 0 ? await getCompareData(orgId, ids) : { kind: "too-few" };

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")}>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/candidates">{t("back")}</Link>
        </Button>
      </PageHeader>

      {outcome.kind === "too-few" && (
        <StateCard icon={Columns3} title={t("tooFewTitle")} body={t("tooFewBody")} />
      )}
      {outcome.kind === "too-many" && (
        <StateCard
          icon={AlertTriangle}
          title={t("tooManyTitle")}
          body={t("tooManyBody", { cap: outcome.cap })}
        />
      )}
      {outcome.kind === "cross-role" && (
        <StateCard icon={Info} title={t("crossRoleTitle")} body={t("crossRoleBody")} />
      )}
      {outcome.kind === "not-found" && (
        <StateCard
          icon={AlertTriangle}
          title={t("notFoundTitle")}
          body={t("notFoundBody")}
          ctaHref="/app/candidates"
          ctaLabel={t("goToCandidates")}
        />
      )}

      {outcome.kind === "ok" && (
        <CompareGrid
          roleTitle={outcome.roleTitle}
          competencyNames={outcome.competencyNames}
          candidates={outcome.candidates}
          rowFit={t("rowFit")}
          bandLabels={{
            PASS: tBands("PASS"),
            PARTIAL: tBands("PARTIAL"),
            BELOW: tBands("BELOW"),
          }}
          radarTitle={t("radarTitle")}
          targetLabel={t("seriesTarget")}
          radarOverflow={t("radarOverflow", { count: outcome.candidates.length })}
        />
      )}
    </div>
  );
}

function CompareGrid({
  roleTitle,
  competencyNames,
  candidates,
  rowFit,
  bandLabels,
  radarTitle,
  targetLabel,
  radarOverflow,
}: {
  roleTitle: string;
  competencyNames: string[];
  candidates: import("@/lib/services/result").ResultView[];
  rowFit: string;
  bandLabels: Record<"PASS" | "PARTIAL" | "BELOW", string>;
  radarTitle: string;
  targetLabel: string;
  radarOverflow: string;
}) {
  // Per-candidate competency lookup by name (they share a role, so names align).
  const byName = candidates.map((c) => {
    const map = new Map(c.scores.competencyScores.map((s) => [s.name, s]));
    return { candidate: c, map };
  });

  // Radar data: one row per competency, a series key per candidate + the target.
  const target = candidates[0]?.scores.competencyScores ?? [];
  const targetByName = new Map(target.map((s) => [s.name, s.targetPercentile]));
  const radarData = competencyNames.map((name) => {
    const row: Record<string, string | number> = {
      competency: name,
      target: targetByName.get(name) ?? 0,
    };
    byName.forEach(({ map }, i) => {
      row[`c${i}`] = map.get(name)?.score ?? 0;
    });
    return row;
  });
  const series = candidates.map((c, i) => ({
    name: c.candidateName ?? c.candidateEmail,
    key: `c${i}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="text-sm text-muted-foreground">{roleTitle}</div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-40" />
              {candidates.map((c) => (
                <TableHead key={c.resultId} className="text-foreground">
                  {c.candidateName ?? c.candidateEmail}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-foreground">{rowFit}</TableCell>
              {candidates.map((c) => (
                <TableCell key={c.resultId} className="tabular-nums font-medium text-foreground">
                  {c.fitScore}
                </TableCell>
              ))}
            </TableRow>
            {competencyNames.map((name) => (
              <TableRow key={name}>
                <TableCell className="text-muted-foreground">{name}</TableCell>
                {byName.map(({ candidate, map }) => {
                  const s = map.get(name);
                  return (
                    <TableCell key={candidate.resultId}>
                      {s ? (
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums text-sm text-foreground">{s.score}</span>
                          <BandPill band={s.band} label={bandLabels[s.band]} />
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{radarTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <CompareRadar
            data={radarData}
            series={series}
            targetKey="target"
            targetLabel={targetLabel}
            overflowNote={radarOverflow}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StateCard({
  icon: Icon,
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  icon: typeof Info;
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <span className="rounded-xl bg-secondary p-3 text-accent">
        <Icon className="size-6" />
      </span>
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      </div>
      {ctaHref && ctaLabel && (
        <Button asChild variant="outline" className="mt-1">
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
      )}
    </Card>
  );
}
