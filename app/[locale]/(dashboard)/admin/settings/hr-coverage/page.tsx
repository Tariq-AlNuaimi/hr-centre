import { HrCoverageSettings } from "@/components/settings/HrCoverageSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Admin › Settings › HR coverage (ADR-102): who covers which unit, for tickets and cases. */
export default async function HrCoverageSettingsPage() {
  await requireSection("/admin/settings/hr-coverage");
  return <HrCoverageSettings />;
}
