import { getTranslations } from "next-intl/server";
import { Columns3 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Placeholder } from "@/components/shared/Placeholder";

export default async function ComparePage() {
  const t = await getTranslations("nav");
  return (
    <div>
      <PageHeader title={t("compare")} />
      <Placeholder title={t("compare")} icon={Columns3} />
    </div>
  );
}
