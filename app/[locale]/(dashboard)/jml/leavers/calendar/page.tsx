import { ExitCalendarScreen } from "@/components/jml/watch/ExitCalendarScreen";
import { requireSection } from "@/lib/nav/page-gate";

/** Exit dates by month. */
export default async function Page() {
  await requireSection("/jml/leavers/calendar");
  return <ExitCalendarScreen />;
}
