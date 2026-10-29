import { ImportExitsSettings } from "@/components/jml/settings/ImportExitsSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Import historical exits from CSV. */
export default async function Page() {
  await requireSection("/jml/settings/import-exits");
  return <ImportExitsSettings />;
}
