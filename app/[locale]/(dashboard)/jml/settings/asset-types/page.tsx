import { LeaverListsSettings } from "@/components/jml/settings/LeaverListsSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Asset types for the register. */
export default async function Page() {
  await requireSection("/jml/settings/asset-types");
  return <LeaverListsSettings kind="asset-types" />;
}
