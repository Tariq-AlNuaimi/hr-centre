import { DocumentsSettings } from "@/components/jml/settings/DocumentsSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Leaver document templates. */
export default async function Page() {
  await requireSection("/jml/settings/documents");
  return <DocumentsSettings />;
}
