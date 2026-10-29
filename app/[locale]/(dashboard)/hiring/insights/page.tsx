import { InsightsView } from "@/components/hiring/insights/InsightsView";
import { requireSection } from "@/lib/nav/page-gate";

export default async function HiringInsightsPage() {
  await requireSection("/hiring/insights");
  return <InsightsView />;
}
