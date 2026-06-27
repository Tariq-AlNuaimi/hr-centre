import { getTranslations } from "next-intl/server";
import { SlidersHorizontal } from "lucide-react";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/shared/PageHeader";
import { Placeholder } from "@/components/shared/Placeholder";

export default async function CalibrationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdmin(locale);
  const t = await getTranslations("nav");
  return (
    <div>
      <PageHeader title={t("calibration")} />
      <Placeholder title={t("calibration")} icon={SlidersHorizontal} />
    </div>
  );
}
