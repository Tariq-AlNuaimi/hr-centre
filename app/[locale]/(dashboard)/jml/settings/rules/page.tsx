import { RulesSettings } from "@/components/jml/settings/RulesSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** HR owner assignment rules (Onboarding §14 / BR-002). */
export default async function Page() {
  await requireSection("/jml/settings/rules");
  return <RulesSettings />;
}
