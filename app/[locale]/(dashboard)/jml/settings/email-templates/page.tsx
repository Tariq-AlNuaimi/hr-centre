import { EmailTemplatesSettings } from "@/components/jml/settings/EmailTemplatesSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Joiner email templates (Onboarding §11.2). */
export default async function Page() {
  await requireSection("/jml/settings/email-templates");
  return <EmailTemplatesSettings />;
}
