import { StatutoryScreen } from "@/components/jml/watch/StatutoryScreen";
import { requireSection } from "@/lib/nav/page-gate";

/** Statutory & visa watch (FR-DASH-008). */
export default async function Page() {
  await requireSection("/jml/statutory");
  return <StatutoryScreen />;
}
