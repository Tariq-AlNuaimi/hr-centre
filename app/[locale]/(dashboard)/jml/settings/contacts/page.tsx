import { ContactSettings } from "@/components/jml/settings/ContactSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Desk emails and case links (core settings store, ADR-092). */
export default async function Page() {
  await requireSection("/jml/settings/contacts");
  return <ContactSettings />;
}
