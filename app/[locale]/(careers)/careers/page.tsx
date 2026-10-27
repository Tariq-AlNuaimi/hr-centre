import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CareersBoard } from "@/components/hiring/careers/CareersBoard";
import { listOpenRoles } from "@/lib/hiring/careers";

/** `/careers` — the public board. Server-rendered from the cached open-roles list (60 s, careers tag). */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("careers");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function CareersPage() {
  return <CareersBoard roles={await listOpenRoles()} />;
}
