import { ApprovalAuthoritySettings } from "@/components/jml/settings/ApprovalAuthoritySettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Approval authority per approval type. */
export default async function Page() {
  await requireSection("/jml/settings/approval-authority");
  return <ApprovalAuthoritySettings />;
}
