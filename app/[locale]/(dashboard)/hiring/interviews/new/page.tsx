import { Suspense } from "react";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { NewInterview } from "@/components/hiring/interviews/NewInterview";

export default function NewInterviewPage() {
  return (
    <Suspense fallback={<FormSkeleton fields={8} />}>
      <NewInterview />
    </Suspense>
  );
}
