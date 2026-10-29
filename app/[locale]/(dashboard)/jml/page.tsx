import { JmlDashboard } from "@/components/jml/dashboard/JmlDashboard";
import { requireSection } from "@/lib/nav/page-gate";

/** The JML landing — the dashboard (slice S7). */
export default async function Page() {
  await requireSection("/jml");
  return <JmlDashboard />;
}
