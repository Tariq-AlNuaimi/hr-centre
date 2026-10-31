import { EmailLogAdmin } from "@/components/settings/EmailLogAdmin";
import { requireSection } from "@/lib/nav/page-gate";

/** Admin › Email log (ADR-095 follow-up): every module's emails, metadata only. */
export default async function EmailLogPage() {
  await requireSection("/admin/email-log");
  return <EmailLogAdmin />;
}
