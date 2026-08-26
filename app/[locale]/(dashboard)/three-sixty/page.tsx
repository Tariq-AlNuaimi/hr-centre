"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { StatCard } from "@/components/shared/StatCard";
import { DataTable } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CyclePicker } from "@/components/pms/CyclePicker";
import { ThreeSixtySetup } from "@/components/pms/ThreeSixtySetup";
import { RaterCoverage } from "@/components/pms/RaterCoverage";
import { ProjectMap } from "@/components/pms/ProjectMap";
import { useCycleSelection } from "@/hooks/use-cycle-selection";
import { usePmsActor } from "@/hooks/use-pms-actor";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

/**
 * §9 — HR's 360 console.
 *
 * §9.4: "HR selects and manages all rater assignments"; §9.6: "auto-generate
 * assignments from the mapping … HR reviews and edits assignments before
 * launch"; §9.7: the cycle is then activated.
 *
 * So the screen follows that sequence top to bottom — generate, review coverage,
 * activate — and the activate button is disabled while anyone is short of §9.4's
 * three raters, with the shortfall named rather than the button silently dead.
 *
 * ## What this screen deliberately does NOT show
 *
 * Results. §13.1 protects rater anonymity, and a screen that pairs "who was
 * assigned" (which HR must see, §9.4) with "what came back" is the join that
 * defeats it. Consolidated results reach the employee on their scorecard and
 * reach scoring through §8.5; nobody needs both halves in one place.
 */

interface ThreeSixtyResponse {
  threeSixty: {
    id: string;
    status: string;
    opensAt: string;
    deadline: string;
    // The route returns each template's QUESTIONS, not a `_count` of them —
    // `_count` on that payload belongs to the cycle and holds `assignments`.
    // This interface used to claim `_count.questions` per template, and since
    // `apiClient.get<T>` is an unchecked cast nothing caught the mismatch: the
    // screen crashed on `_count` being undefined the moment a 360 had templates,
    // which is every 360 that exists, because §9.2 creates them with the cycle.
    templates?: Array<{ id: string; type: string; questions: Array<{ id: string }> }>;
  } | null;
}

interface AssignmentsResponse {
  scope: "all" | "mine";
  assignments: Array<{
    id: string;
    status: string;
    submittedAt?: string | null;
    ratee: { id: string; name: string };
    rater?: { id: string; name: string };
    template: { type: string };
  }>;
  coverage?: Array<{ rateeId: string; name: string; raterCount: number }>;
}

/** §9.4 — "Raters — exactly 3 per employee". */
const RATERS_PER_EMPLOYEE = 3;

/**
 * The reads and writes this console runs.
 *
 * Extracted for the reason the mid-year workspace was: a component that both
 * orchestrates four server calls and renders five distinct states crosses the
 * complexity budget, and the honest seam is between DECIDING what to fetch and
 * RENDERING what came back.
 */
function useThreeSixtyConsole(cycleId: string | null, enabled: boolean) {
  const t = useTranslations("pms.threeSixty");
  const queryClient = useQueryClient();

  const cycle = useQuery({
    queryKey: ["pms", "360", cycleId],
    queryFn: () => apiClient.get<ThreeSixtyResponse>(`/api/three-sixty?cycleId=${cycleId}`),
    enabled: enabled && cycleId !== null,
  });

  const threeSixtyId = cycle.data?.threeSixty?.id ?? null;

  const assignments = useQuery({
    queryKey: ["pms", "360", "assignments", threeSixtyId],
    queryFn: () =>
      apiClient.get<AssignmentsResponse>(
        `/api/three-sixty/assignments?threeSixtyCycleId=${threeSixtyId}`,
      ),
    enabled: threeSixtyId !== null,
  });

  const generate = useMutation({
    mutationFn: () =>
      apiClient.put<{ created: number; rateeCount: number; shortfalls: unknown[] }>(
        "/api/three-sixty/assignments",
        { threeSixtyCycleId: threeSixtyId },
      ),
    onSuccess: (result) => {
      toast.success(t("generated", { count: result.created }));
      void queryClient.invalidateQueries({ queryKey: ["pms", "360", "assignments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const activate = useMutation({
    mutationFn: () =>
      apiClient.post("/api/three-sixty/activate", { threeSixtyCycleId: threeSixtyId }),
    onSuccess: () => {
      toast.success(t("activated"));
      void queryClient.invalidateQueries({ queryKey: ["pms", "360"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const coverage = assignments.data?.coverage ?? [];
  return {
    cycle,
    assignments,
    threeSixty: cycle.data?.threeSixty ?? null,
    coverage,
    // §9.4's "exactly 3 per employee" — who is short, computed once.
    short: coverage.filter((c) => c.raterCount < RATERS_PER_EMPLOYEE),
    generate,
    activate,
  };
}

export default function ThreeSixtyPage() {
  const t = useTranslations("pms.threeSixty");
  const { capabilities, isLoading: actorLoading } = usePmsActor();
  const { cycles, cycleList, cycleId, selectedCycleId, setSelectedCycleId } = useCycleSelection();
  const { cycle, threeSixty, coverage, short, generate, activate, assignments } =
    useThreeSixtyConsole(cycleId, capabilities.orgWide);

  if (actorLoading || cycles.isLoading) return <PageSkeleton />;

  if (!capabilities.orgWide) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("notPermitted")}>
          <EmptyState description={t("notPermittedHelp")} />
        </SectionCard>
      </div>
    );
  }

  if (cycleList.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <SectionCard title={t("noCycles")}>
          <EmptyState description={t("noCyclesHelp")} />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <CyclePicker
            cycles={cycleList}
            value={selectedCycleId ?? cycleId}
            onChange={setSelectedCycleId}
          />
        }
      />

      {cycle.isLoading && <PageSkeleton />}

      {/* §9.1/§9.2 — the cycle and its three templates are created together,
          because a 360 cycle without templates cannot be answered and §9.7's
          activation would refuse it anyway. Until this screen existed, nothing
          in the product could create either. */}
      {!cycle.isLoading && !threeSixty && cycleId && <ThreeSixtySetup cycleId={cycleId} />}

      {threeSixty && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title={t("status")}
              value={
                <Badge variant={threeSixty.status === "ACTIVE" ? "success" : "outline"}>
                  {t(`statusValue.${threeSixty.status}`)}
                </Badge>
              }
            />
            <StatCard title={t("opensAt")} value={formatDateTime(threeSixty.opensAt)} />
            <StatCard title={t("deadline")} value={formatDateTime(threeSixty.deadline)} />
            <StatCard
              title={t("raters")}
              value={coverage.length}
              hint={t("shortfall", { count: short.length })}
            />
          </div>

          <SectionCard title={t("templates")} subtitle={t("templatesHelp")}>
            {threeSixty.templates && threeSixty.templates.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {threeSixty.templates.map((template) => (
                  <li key={template.id} className="flex items-center justify-between gap-3">
                    <span>{t(`templateType.${template.type}`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("questions", { count: template.questions.length })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState description={t("noTemplates")} />
            )}
          </SectionCard>

          <RaterCoverage
            threeSixtyId={threeSixty.id}
            status={threeSixty.status}
            coverage={coverage}
            short={short}
            assignments={assignments.data?.assignments ?? []}
            generate={generate}
            activate={activate}
          />

          {/* §9.6's optional project mapping — the other half of "peers can be
              drawn from shared project work", and the only way a small
              department reaches three eligible raters. */}
          {cycleId && threeSixty.status === "DRAFT" && <ProjectMap cycleId={cycleId} />}
        </>
      )}
    </div>
  );
}
