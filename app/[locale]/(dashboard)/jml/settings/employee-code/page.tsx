import { EmployeeCodeSettings } from "@/components/jml/settings/EmployeeCodeSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Employee code cutover (Onboarding §14.1). */
export default async function Page() {
  await requireSection("/jml/settings/employee-code");
  return <EmployeeCodeSettings />;
}
