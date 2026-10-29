import { LeaverListsSettings } from "@/components/jml/settings/LeaverListsSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** The access-revocation checklist. */
export default async function Page() {
  await requireSection("/jml/settings/access-checklist");
  return <LeaverListsSettings kind="access-checklist" />;
}
