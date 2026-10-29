import { CodedListSettings } from "@/components/jml/settings/CodedListSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Contract types (Onboarding §7.4). */
export default async function Page() {
  await requireSection("/jml/settings/contract-types");
  return <CodedListSettings kind="contract-types" />;
}
