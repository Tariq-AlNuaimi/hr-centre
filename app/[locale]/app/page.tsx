import { getTranslations, getFormatter } from "next-intl/server";
import { Send, PlayCircle, CheckCircle2, ClipboardList } from "lucide-react";
import { requireSession } from "@/lib/authz";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDashboardSnapshot, listCandidates } from "@/lib/services/result";
import { listActiveRoleProfiles } from "@/lib/services/invitation";

// Dashboard (UI-SPEC D.1). RSC: real tenant-scoped pipeline counts wired to the
// service; each tile links into the candidates list. Awaiting-review + active-roles
// render real rows or honest empties. Manager-readable (requireSession).
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireSession(locale);
  const orgId = session.user.orgId;

  const t = await getTranslations("dashboard");
  const tCand = await getTranslations("candidates");
  const format = await getFormatter();

  const [snapshot, awaiting, roleProfiles] = orgId
    ? await Promise.all([
        getDashboardSnapshot(orgId),
        listCandidates(orgId, { skip: 0, take: 5, submittedOnly: true, undecided: true }),
        listActiveRoleProfiles(orgId),
      ])
    : [
        { invited: 0, started: 0, completed: 0, awaitingReview: 0 },
        { data: [], total: 0 },
        [],
      ];

  const tiles = [
    { key: "invitesSent", value: snapshot.invited, icon: Send, href: "/app/candidates" },
    { key: "started", value: snapshot.started, icon: PlayCircle, href: "/app/candidates" },
    { key: "completed", value: snapshot.completed, icon: CheckCircle2, href: "/app/candidates" },
    {
      key: "awaitingReview",
      value: snapshot.awaitingReview,
      icon: ClipboardList,
      href: "/app/candidates",
    },
  ] as const;

  // The real review backlog: listCandidates already filtered to undecided sittings
  // (same awaitingReviewWhere() the tile counts), so the panel and tile agree.
  const awaitingRows = awaiting.data;

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.key}
            href={tile.href}
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <StatCard
              label={t(tile.key)}
              value={tile.value}
              icon={tile.icon}
              className="transition-colors hover:border-accent"
            />
          </Link>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("awaitingReviewTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {awaitingRows.length === 0 ? (
              <EmptyRow text={t("awaitingReviewEmpty")} />
            ) : (
              <ul className="flex flex-col">
                {awaitingRows.map((row) => (
                  <li key={row.assessmentId}>
                    <Link
                      href={`/app/candidates/${row.assessmentId}`}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 text-sm hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                    >
                      <span className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {row.candidateName ?? row.candidateEmail}
                        </span>
                        <span className="text-xs text-muted-foreground">{row.roleTitle}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        {row.fitScore !== null && (
                          <span className="tabular-nums text-sm text-foreground">
                            {row.fitScore}
                          </span>
                        )}
                        {row.completedAt && (
                          <span className="text-xs text-muted-foreground">
                            {format.dateTime(row.completedAt, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                        <Badge variant="default">{tCand("decision.none")}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("activeRoles")}</CardTitle>
          </CardHeader>
          <CardContent>
            {roleProfiles.length === 0 ? (
              <EmptyRow text={t("activeRolesEmpty")} />
            ) : (
              <ul className="flex flex-col gap-1">
                {roleProfiles.slice(0, 6).map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm"
                  >
                    <span className="text-foreground">{r.title}</span>
                    <span className="text-xs text-muted-foreground">{r.roleFamily.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t("recentActivity")}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyRow text={t("recentActivityEmpty")} />
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
      <span
        className="journey-line w-10 shrink-0"
        style={{ "--journey": "40%" } as React.CSSProperties}
      />
      {text}
    </div>
  );
}
