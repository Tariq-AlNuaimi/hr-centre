import { TemplatesSettings } from "@/components/jml/settings/TemplatesSettings";
import { requireSection } from "@/lib/nav/page-gate";

/** Checklist templates for joiners, movers and leavers. */
export default async function Page() {
  await requireSection("/jml/settings/templates");
  return <TemplatesSettings />;
}
