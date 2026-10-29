import { MyTasksScreen } from "@/components/jml/dashboard/MyTasksScreen";
import { requireSection } from "@/lib/nav/page-gate";

/** My open JML tasks. */
export default async function Page() {
  await requireSection("/jml/my-tasks");
  return <MyTasksScreen />;
}
