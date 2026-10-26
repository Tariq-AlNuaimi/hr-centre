import { Suspense } from "react";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { NewCandidate } from "@/components/hiring/candidates/NewCandidate";

export default function NewCandidatePage() {
  return (
    <Suspense fallback={<FormSkeleton fields={10} />}>
      <NewCandidate />
    </Suspense>
  );
}
