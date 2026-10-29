import { CodedListSettings } from "@/components/jml/settings/CodedListSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Position classifications (Offboarding C8). */
export default async function Page() {
  await requireSection("/jml/settings/classifications");
  return <CodedListSettings kind="classifications" />;
}
