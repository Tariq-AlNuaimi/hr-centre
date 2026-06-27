import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Placeholder } from "@/components/shared/Placeholder";

export default async function CandidatesPage() {
  const t = await getTranslations("nav");
  return (
    <div>
      <PageHeader title={t("candidates")} />
      <Placeholder title={t("candidates")} icon={Users} />
    </div>
  );
}
