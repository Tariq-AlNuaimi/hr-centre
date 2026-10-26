import { AssessmentView } from "@/components/hiring/requisitions/AssessmentView";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssessmentView id={id} />;
}
