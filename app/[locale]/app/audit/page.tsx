import { getTranslations } from "next-intl/server";
import { ScrollText } from "lucide-react";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/shared/PageHeader";
import { Placeholder } from "@/components/shared/Placeholder";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdmin(locale);
  const t = await getTranslations("nav");
  return (
    <div>
      <PageHeader title={t("audit")} />
      <Placeholder title={t("audit")} icon={ScrollText} />
    </div>
  );
}
