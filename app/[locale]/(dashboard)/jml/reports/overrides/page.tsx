import { OverridesScreen } from "@/components/jml/reports/OverridesScreen";
import { requireSection } from "@/lib/nav/page-gate";

/** The monthly compliance-gate override report. */
export default async function Page() {
  await requireSection("/jml/reports");
  return <OverridesScreen />;
}
