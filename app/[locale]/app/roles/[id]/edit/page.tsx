import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/shared/PageHeader";
import { getRoleProfile, isEditable } from "@/lib/services/roleProfile";
import { RoleProfileWizard, type WizardInitial } from "../../RoleProfileWizard";

// Edit a DRAFT/IN_REVIEW profile (UI-SPEC D.3). Admin-only. A locked
// (APPROVED/ACTIVE/ARCHIVED) version can't be edited — send the user to the
// read-only detail where they can clone a new version instead.
export default async function EditRoleProfilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const session = await requireAdmin(locale);
  const orgId = session.user.orgId;
  const t = await getTranslations("roleProfiles");

  const profile = orgId ? await getRoleProfile(orgId, id) : null;
  if (!profile) notFound();
  if (!isEditable(profile.status)) {
    redirect(`/${locale}/app/roles/${id}`);
  }

  const families = orgId
    ? await prisma.roleFamily.findMany({
        where: { orgId },
        select: { id: true, key: true, name: true },
        orderBy: { name: "asc" },
        take: 200, // reference table, bounded (Pillar 4: Scalable)
      })
    : [];

  const initial: WizardInitial = {
    id: profile.id,
    roleFamilyId: profile.roleFamilyId,
    title: profile.title,
    jdSourceText: profile.jdSourceText ?? "",
    isAiDrafted: profile.isAiDrafted,
    competencies: profile.competencies.map((c) => ({
      name: c.name,
      facets: c.facets.map((f) => f.facet),
      direction: c.direction,
      targetPercentile: c.targetPercentile,
      weight: c.weight,
      onetRef: c.onetRef ?? "",
      sourceCitation: c.sourceCitation ?? "",
    })),
    sjtItems: profile.sjtItems.map((s) => {
      const opts = (s.options as Array<{ id: string; text_en: string }>) ?? [];
      const key = (s.scoringKey as {
        bestOptionId?: string;
        worstOptionId?: string | null;
      } | null) ?? {};
      return {
        scenario_en: s.scenario_en,
        options: opts.map((o) => ({ id: o.id, text_en: o.text_en })),
        bestOptionId: key.bestOptionId ?? opts[0]?.id ?? "",
        worstOptionId: key.worstOptionId ?? "",
      };
    }),
  };

  return (
    <div>
      <PageHeader
        title={t("editTitle", { title: profile.title })}
        description={t("editSubtitle")}
      />
      <RoleProfileWizard families={families} initial={initial} />
    </div>
  );
}
