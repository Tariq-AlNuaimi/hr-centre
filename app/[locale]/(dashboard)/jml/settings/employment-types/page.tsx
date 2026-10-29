import { EmploymentTypesSettings } from "@/components/jml/settings/EmploymentTypesSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Employment-type configuration (Onboarding EmploymentTypeConfig). */
export default async function Page() {
  await requireSection("/jml/settings/employment-types");
  return <EmploymentTypesSettings />;
}
