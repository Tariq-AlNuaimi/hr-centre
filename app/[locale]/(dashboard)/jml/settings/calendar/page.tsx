import { CalendarSettings } from "@/components/jml/settings/CalendarSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Working calendar: weekly schedule and public holidays (ADR-077). */
export default async function Page() {
  await requireSection("/jml/settings/calendar");
  return <CalendarSettings />;
}
