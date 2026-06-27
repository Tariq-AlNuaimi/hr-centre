import { getTranslations, getFormatter } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListChecks, Quote, History, Lock } from "lucide-react";
import { requireSession } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getRoleProfile,
  listVersions,
  maskScoringKeys,
  isEditable,
} from "@/lib/services/roleProfile";
import type { RoleProfileStatus } from "@/generated/prisma/client";
import { StatusBadge } from "../StatusBadge";
import { RoleProfileActions } from "./RoleProfileActions";

// Role-profile detail (UI-SPEC D.4). RSC reads via the service; SJT scoring keys
// are masked server-side for non-admins. Managers see the full read-only view but
// no action buttons (the server is the real gate).
export default async function RoleProfileDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const session = await requireSession(locale);
  const orgId = session.user.orgId;
  const isAdmin = session.user.role === "HR_ADMIN";

  const t = await getTranslations("roleProfiles");
  const tStatus = await getTranslations("roleProfiles.status");
  const tDir = await getTranslations("roleProfiles.directions");
  const tFacet = await getTranslations("roleProfiles.facets");
  const format = await getFormatter();

  const raw = orgId ? await getRoleProfile(orgId, id) : null;
  if (!raw) notFound();
  const profile = maskScoringKeys(raw, isAdmin);

  const versions = orgId ? await listVersions(orgId, profile.lineageId) : [];

  // Resolve actor names for the timeline (createdBy/approvedBy are ids).
  const actorIds = Array.from(
    new Set(
      versions.flatMap((v) =>
        [v.createdById, v.approvedById].filter((x): x is string => Boolean(x))
      )
    )
  );
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds }, orgId: orgId ?? undefined },
        select: { id: true, name: true, email: true },
        take: actorIds.length, // bounded by the resolved actor id set (Pillar 4)
      })
    : [];
  const actorName = (uid: string | null) => {
    if (!uid) return null;
    const u = actors.find((a) => a.id === uid);
    return u?.name ?? u?.email ?? null;
  };

  const editable = isEditable(profile.status);

  return (
    <div>
      <PageHeader
        title={profile.title}
        description={t("detailSubtitle", { family: profile.roleFamily.name })}
      >
        {isAdmin && <RoleProfileActions id={profile.id} isEditable={editable} />}
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <StatusBadge
          status={profile.status as RoleProfileStatus}
          label={tStatus(profile.status)}
        />
        <span className="tabular-nums">{t("versionN", { n: profile.version })}</span>
        <span>·</span>
        <span>{profile.roleFamily.name}</span>
        {profile.isAiDrafted && (
          <Badge variant="accent">{t("aiDraftedBadge")}</Badge>
        )}
        {!editable && (
          <span className="inline-flex items-center gap-1 text-xs">
            <Lock className="size-3.5" />
            {t("lockedHint")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Competencies */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="size-4 text-accent" />
                {t("competenciesTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {profile.competencies.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("noCompetencies")}
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {profile.competencies.map((c) => (
                    <li key={c.id} className="flex flex-col gap-2 py-4 first:pt-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">
                          {c.name}
                        </span>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                          <Badge variant="outline">{tDir(c.direction)}</Badge>
                          <span>{t("targetPctLabel", { pct: c.targetPercentile })}</span>
                          <span>·</span>
                          <span>{t("weightLabel", { weight: c.weight })}</span>
                        </div>
                      </div>
                      {c.facets.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5">
                          {c.facets.map((f) => (
                            <li key={f.facet}>
                              <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                                {tFacet(f.facet)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {c.sourceCitation && (
                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Quote className="mt-0.5 size-3.5 shrink-0 text-[var(--rihal-sand)]" />
                          <span>{c.sourceCitation}</span>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* SJT scenarios */}
          {profile.sjtItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("sjtTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y divide-border">
                  {profile.sjtItems.map((s, i) => {
                    const opts =
                      (s.options as Array<{ id: string; text_en: string }>) ?? [];
                    const key = s.scoringKey as {
                      bestOptionId?: string;
                      worstOptionId?: string | null;
                    } | null;
                    return (
                      <li key={s.id} className="flex flex-col gap-2 py-4 first:pt-0">
                        <p className="text-sm font-medium text-foreground">
                          {t("sjtN", { n: i + 1 })}. {s.scenario_en}
                        </p>
                        <ul className="flex flex-col gap-1">
                          {opts.map((o) => {
                            const isBest = key?.bestOptionId === o.id;
                            const isWorst = key?.worstOptionId === o.id;
                            return (
                              <li
                                key={o.id}
                                className="flex items-center gap-2 text-sm text-muted-foreground"
                              >
                                <span className="font-mono text-xs uppercase">
                                  {o.id}
                                </span>
                                <span className="text-foreground">{o.text_en}</span>
                                {isAdmin && isBest && (
                                  <Badge variant="pass">{t("bestTag")}</Badge>
                                )}
                                {isAdmin && isWorst && (
                                  <Badge variant="below">{t("worstTag")}</Badge>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {!isAdmin && (
                          <p className="text-xs text-muted-foreground">
                            {t("keyMasked")}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Version history timeline */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="size-4 text-accent" />
              {t("historyTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-4">
              {versions.map((v) => {
                const isCurrent = v.id === profile.id;
                return (
                  <li key={v.id} className="flex gap-3">
                    <span
                      className="journey-line mt-1.5 w-1 shrink-0"
                      aria-hidden
                      style={{ "--journey": "100%" } as React.CSSProperties}
                    />
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground tabular-nums">
                          {t("versionN", { n: v.version })}
                        </span>
                        <StatusBadge
                          status={v.status as RoleProfileStatus}
                          label={tStatus(v.status)}
                        />
                        {isCurrent && (
                          <span className="text-xs text-accent">
                            {t("viewing")}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {actorName(v.createdById)
                          ? t("createdByOn", {
                              who: actorName(v.createdById)!,
                              when: format.dateTime(v.createdAt, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              }),
                            })
                          : format.dateTime(v.createdAt, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                      </p>
                      {v.approvedAt && actorName(v.approvedById) && (
                        <p className="text-xs text-muted-foreground">
                          {t("approvedByOn", {
                            who: actorName(v.approvedById)!,
                            when: format.dateTime(v.approvedAt, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            }),
                          })}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
