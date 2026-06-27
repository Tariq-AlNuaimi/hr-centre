import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/shared/PageHeader";
import { RoleProfileWizard } from "../RoleProfileWizard";

// New role profile (UI-SPEC D.3). Admin-only — gated server-side (requireAdmin
// redirects a manager), mirroring the API's withAdminAuth.
export default async function NewRoleProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireAdmin(locale);
  const t = await getTranslations("roleProfiles");

  const families = session.user.orgId
    ? await prisma.roleFamily.findMany({
        where: { orgId: session.user.orgId },
        select: { id: true, key: true, name: true },
        orderBy: { name: "asc" },
        take: 200, // reference table, bounded (Pillar 4: Scalable)
      })
    : [];

  return (
    <div>
      <PageHeader title={t("newProfile")} description={t("newSubtitle")} />
      <RoleProfileWizard families={families} />
    </div>
  );
}
