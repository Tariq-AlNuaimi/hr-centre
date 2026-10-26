import { EvaluationDetail } from "@/components/hiring/evaluations/EvaluationDetail";

export default async function EvaluationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EvaluationDetail id={id} />;
}
