import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import { RolesSection } from "@/components/rbac/RolesSection";
import { AssignmentsSection } from "@/components/rbac/AssignmentsSection";
import { AccessPreview } from "@/components/rbac/AccessPreview";

/**
 * Roles & access — blueprint §3 (F-c). PLATFORM ADMINS ONLY (`User.role =
 * ADMIN`): HR cannot change its own powers. Anyone else gets a 404 (AC-F3.3;
 * QA2 N-17); the /api/rbac routes refuse them with 403 too.
 */
export default async function RolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  if (!session) redirect(`/${locale}/login`);
  // QA2 N-17 — a real 404 status, not a redirect to a 200 "Access denied" page
  // (admin/ has no loading boundary above this page, so the status holds).
  if (session.user.role !== "ADMIN") notFound();
  const t = await getTranslations("rbac");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <RolesSection />
      <AssignmentsSection />
      <AccessPreview />
    </div>
  );
}
