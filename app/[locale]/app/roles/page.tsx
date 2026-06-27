import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/shared/PageHeader";
import { Placeholder } from "@/components/shared/Placeholder";

export default async function RolesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdmin(locale);
  const t = await getTranslations("nav");
  return (
    <div>
      <PageHeader title={t("roleProfiles")} />
      <Placeholder title={t("roleProfiles")} icon={FileText} />
    </div>
  );
}
