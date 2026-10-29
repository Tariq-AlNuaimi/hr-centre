import { LeaverList } from "@/components/jml/leavers/LeaverList";
import { requireSection } from "@/lib/nav/page-gate";

/** Leavers — exit cases in flight and done. */
export default async function Page() {
  await requireSection("/jml/leavers");
  return <LeaverList />;
}
