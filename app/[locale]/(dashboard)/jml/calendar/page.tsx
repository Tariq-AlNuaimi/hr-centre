import { CalendarScreen } from "@/components/jml/watch/CalendarScreen";
import { requireSection } from "@/lib/nav/page-gate";

/** The joining calendar (HR Onboarding §12). */
export default async function Page() {
  await requireSection("/jml/calendar");
  return <CalendarScreen />;
}
