import { RetentionSettings } from "@/components/jml/settings/RetentionSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Data retention — the rule and a dry run. */
export default async function Page() {
  await requireSection("/jml/settings/retention");
  return <RetentionSettings />;
}
