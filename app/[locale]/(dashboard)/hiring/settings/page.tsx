import { SettingsView } from "@/components/hiring/settings/SettingsView";
import { requireSection } from "@/lib/nav/page-gate";

export default async function HiringSettingsPage() {
  await requireSection("/hiring/settings");
  return <SettingsView />;
}
