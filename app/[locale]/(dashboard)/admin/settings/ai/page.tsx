import { PlatformAiSettings } from "@/components/settings/PlatformAiSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Admin › Settings › AI (ADR-097): the platform's AI provider and limits. */
export default async function AiSettingsPage() {
  await requireSection("/admin/settings/ai");
  return <PlatformAiSettings />;
}
