import { ReasonCodesSettings } from "@/components/jml/settings/ReasonCodesSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** The exit-reason taxonomy. */
export default async function Page() {
  await requireSection("/jml/settings/reason-codes");
  return <ReasonCodesSettings />;
}
