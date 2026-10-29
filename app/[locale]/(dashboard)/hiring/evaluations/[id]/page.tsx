import { EvaluationDetail } from "@/components/hiring/evaluations/EvaluationDetail";
import { requireRecord } from "@/lib/nav/record-gate";

export default async function EvaluationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRecord("hiring.evaluation", id);
  return <EvaluationDetail id={id} />;
}
