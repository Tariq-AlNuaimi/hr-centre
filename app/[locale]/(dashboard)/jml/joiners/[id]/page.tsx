import { JoinerForm } from "@/components/jml/joiners/JoinerForm";

/** One joiner — edit the record and, for a draft, activate onboarding. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JoinerForm caseId={id} />;
}
