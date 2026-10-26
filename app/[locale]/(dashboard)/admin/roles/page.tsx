import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import { RolesSection } from "@/components/rbac/RolesSection";
import { AssignmentsSection } from "@/components/rbac/AssignmentsSection";

/**
 * Roles & access — blueprint §3 (F-c). PLATFORM ADMINS ONLY (`User.role =
 * ADMIN`): HR cannot change its own powers. Anyone else is sent to the
 * forbidden page (AC-F3.3); the /api/rbac routes refuse them with 403 too.
 */
export default async function RolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  if (!session) redirect(`/${locale}/login`);
  if (session.user.role !== "ADMIN") redirect(`/${locale}/forbidden`);
  const t = await getTranslations("rbac");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <RolesSection />
      <AssignmentsSection />
    </div>
  );
}
