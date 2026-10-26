import { Suspense } from "react";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { ImportView } from "@/components/hiring/candidates/ImportView";

export default function ImportPage() {
  return (
    <Suspense fallback={<FormSkeleton fields={3} />}>
      <ImportView />
    </Suspense>
  );
}
