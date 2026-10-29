import { SettingsHub } from "@/components/jml/settings/SettingsHub";
import { requireSection } from "@/lib/nav/page-gate";

/** Joiners, movers & leavers — configuration hub (docs/blueprints/jml.md, slice S2). */
export default async function Page() {
  await requireSection("/jml/settings");
  return <SettingsHub />;
}
