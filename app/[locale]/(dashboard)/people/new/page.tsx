import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/pms/actor";
import { PageHeader } from "@/components/shared/PageHeader";
import { AddEmployeeForm } from "@/components/people/AddEmployeeForm";

/**
 * Add employee — blueprint §5 (F-b). Form archetype. Only for an actor who may
 * edit people (the API enforces the same); anyone else gets a 404, not a form
 * that would be refused on submit.
 */
export default async function AddEmployeePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  if (!session) redirect(`/${locale}/login`);
  const actor = await resolveActor(session);
  if (!actor.capabilities.configure) notFound();
  const t = await getTranslations("people.add");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <AddEmployeeForm
        locale={locale}
        canEditPersonal={actor.capabilities.viewPersonal}
        canEditIdDocuments={actor.capabilities.viewIdDocuments}
      />
    </div>
  );
}
