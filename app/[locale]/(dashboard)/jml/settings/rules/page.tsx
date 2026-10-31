import { redirect } from "next/navigation";
import { requireSection } from "@/lib/nav/page-gate";

/**
 * HR owner assignment rules now live on the core HR coverage screen (ADR-102):
 * one place for who covers which unit, for tickets and for cases.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  await requireSection("/jml/settings/rules");
  redirect(`/${(await params).locale}/admin/settings/hr-coverage`);
}
