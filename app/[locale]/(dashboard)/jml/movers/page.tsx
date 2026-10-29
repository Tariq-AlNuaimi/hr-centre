import { MoverList } from "@/components/jml/movers/MoverList";
import { requireSection } from "@/lib/nav/page-gate";

/** Movers — internal changes in flight and done. */
export default async function Page() {
  await requireSection("/jml/movers");
  return <MoverList />;
}
