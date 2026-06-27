import { getTranslations, getFormatter } from "next-intl/server";
import { Users } from "lucide-react";
import { requireSession } from "@/lib/authz";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
} from "@/components/ui/table";
import { listCandidates } from "@/lib/services/result";
import { listActiveRoleProfiles } from "@/lib/services/invitation";
import { DECISION_OUTCOMES, type DecisionOutcomeValue } from "@/lib/validations/result";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { CandidatesFilter } from "./CandidatesFilter";
import { CandidatesTableBody } from "./CandidatesTableBody";

// Candidates list (UI-SPEC D.6). RSC read via the service (no client fetch);
// manager-readable (requireSession = HR_ADMIN or HIRING_MANAGER). Filter + bulk-
// select + compare are client islands; the list stays a server read driven by
// query params. Bounded + paginated (parsePagination) — no unbounded query.
export default async function CandidatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; role?: string; decision?: string }>;
}) {
  const { locale } = await params;
  const { page: pageParam, role: roleParam, decision: decisionParam } = await searchParams;
  const session = await requireSession(locale);
  const orgId = session.user.orgId;

  const t = await getTranslations("candidates");
  const tStatus = await getTranslations("candidates.status");
  const tDecision = await getTranslations("candidates.decision");
  const format = await getFormatter();

  const sp = new URLSearchParams();
  if (pageParam) sp.set("page", pageParam);
  const pagination = parsePagination(sp);

  const decision = DECISION_OUTCOMES.includes(decisionParam as DecisionOutcomeValue)
    ? (decisionParam as DecisionOutcomeValue)
    : undefined;
  const roleProfileId = roleParam || undefined;

  const [{ data, total }, roleProfiles] = orgId
    ? await Promise.all([
        listCandidates(orgId, {
          skip: pagination.skip,
          take: pagination.take,
          roleProfileId,
          decision,
          submittedOnly: true,
        }),
        listActiveRoleProfiles(orgId),
      ])
    : [{ data: [], total: 0 }, []];

  const { totalPages, page } = paginatedResponse(data, total, pagination);
  const hasFilter = Boolean(roleProfileId || decision);
  const hasAny = total > 0 || hasFilter;

  function pageHref(p: number): string {
    const q = new URLSearchParams();
    q.set("page", String(p));
    if (roleProfileId) q.set("role", roleProfileId);
    if (decision) q.set("decision", decision);
    return `/app/candidates?${q.toString()}`;
  }

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />

      {hasAny && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <CandidatesFilter
            roleProfiles={roleProfiles.map((r) => ({ id: r.id, title: r.title }))}
            currentRole={roleProfileId}
            currentDecision={decision}
          />
          <span className="text-sm tabular-nums text-muted-foreground">{total}</span>
        </div>
      )}

      {data.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <span className="rounded-xl bg-secondary p-3 text-accent">
            <Users className="size-6" />
          </span>
          <div className="flex flex-col items-center gap-1.5">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {hasFilter ? t("emptyFilteredTitle") : t("emptyTitle")}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {hasFilter ? t("emptyFilteredBody") : t("emptyBody")}
            </p>
          </div>
          {hasFilter && (
            <Button asChild variant="outline" className="mt-1">
              <Link href="/app/candidates">{t("clearFilters")}</Link>
            </Button>
          )}
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">{t("select")}</span>
                </TableHead>
                <TableHead>{t("colCandidate")}</TableHead>
                <TableHead>{t("colRole")}</TableHead>
                <TableHead className="text-end">{t("colFit")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colCompleted")}</TableHead>
                <TableHead>{t("colDecision")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <CandidatesTableBody
                rows={data.map((r) => ({
                  assessmentId: r.assessmentId,
                  resultId: r.resultId,
                  candidateEmail: r.candidateEmail,
                  candidateName: r.candidateName,
                  roleTitle: r.roleTitle,
                  roleFamily: r.roleFamily,
                  roleProfileId: r.roleProfileId,
                  status: r.status,
                  statusLabel: tStatus(r.status),
                  completedAt: r.completedAt
                    ? format.dateTime(r.completedAt, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                    : null,
                  fitScore: r.fitScore,
                  decision: r.decision,
                  decisionLabel: r.decision ? tDecision(r.decision) : null,
                }))}
              />
            </TableBody>
          </Table>
        </Card>
      )}

      {totalPages > 1 && (
        <nav
          className="mt-4 flex items-center justify-between text-sm text-muted-foreground"
          aria-label={t("pagination")}
        >
          <span className="tabular-nums">{t("pageOf", { page, totalPages })}</span>
          <div className="flex items-center gap-2">
            {page <= 1 ? (
              <Button variant="outline" size="sm" disabled>
                {t("prev")}
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page - 1)}>{t("prev")}</Link>
              </Button>
            )}
            {page >= totalPages ? (
              <Button variant="outline" size="sm" disabled>
                {t("next")}
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page + 1)}>{t("next")}</Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
