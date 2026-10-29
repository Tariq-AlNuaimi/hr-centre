import { StatutorySettings } from "@/components/jml/settings/StatutorySettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Statutory parameters (Offboarding US16). */
export default async function Page() {
  await requireSection("/jml/settings/statutory");
  return <StatutorySettings />;
}
