import { Suspense } from "react";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { EvaluationNew } from "@/components/hiring/evaluations/EvaluationNew";

export default function NewEvaluationPage() {
  return (
    <Suspense fallback={<FormSkeleton fields={8} />}>
      <EvaluationNew />
    </Suspense>
  );
}
