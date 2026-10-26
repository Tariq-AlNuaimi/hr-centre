import { OrgSetup } from "@/components/org/OrgSetup";

/**
 * Organisation setup — blueprint §1 (F-a): companies (rename only),
 * directorates, departments and teams. Imports place people into these units;
 * they never create them.
 */
export default function OrgSetupPage() {
  return <OrgSetup />;
}
