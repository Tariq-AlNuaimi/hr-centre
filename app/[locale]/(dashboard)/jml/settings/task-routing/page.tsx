import { TaskRoutingSettings } from "@/components/jml/settings/TaskRoutingSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Task routing — the people on the IT and Finance desks. */
export default async function Page() {
  await requireSection("/jml/settings/task-routing");
  return <TaskRoutingSettings />;
}
