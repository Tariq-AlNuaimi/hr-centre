import { ReportsIndex } from "@/components/jml/reports/ReportsIndex";
import { requireSection } from "@/lib/nav/page-gate";

/** JML reports (jml.viewReports — checked here and by every report route). */
export default async function Page() {
  await requireSection("/jml/reports");
  return <ReportsIndex />;
}
