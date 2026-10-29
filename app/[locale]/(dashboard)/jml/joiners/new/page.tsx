import { JoinerForm } from "@/components/jml/joiners/JoinerForm";
import { requireSection } from "@/lib/nav/page-gate";

/** Add a joiner (saves a draft; activation is a separate step). */
export default async function Page() {
  await requireSection("/jml/joiners/new");
  return <JoinerForm />;
}
