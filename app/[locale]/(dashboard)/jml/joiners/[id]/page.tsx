import { JoinerForm } from "@/components/jml/joiners/JoinerForm";
import { requireSection } from "@/lib/nav/page-gate";
import { requireRecord } from "@/lib/nav/record-gate";

/** One joiner — edit the record and, for a draft, activate onboarding. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSection("/jml/joiners/[id]");
  await requireRecord("jml.joiner", id);
  return <JoinerForm caseId={id} />;
}
