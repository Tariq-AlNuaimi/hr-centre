import { CaseList } from "@/components/jml/cases/CaseList";
import { requireSection } from "@/lib/nav/page-gate";

/** Every joiner, mover and leaver case the actor may see. */
export default async function Page() {
  await requireSection("/jml/cases");
  return <CaseList />;
}
