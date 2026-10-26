import { Suspense } from "react";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { HiringRequestForm } from "@/components/hiring/requisitions/HiringRequestForm";

export default function HiringRequestPage() {
  return (
    <Suspense fallback={<FormSkeleton fields={8} />}>
      <HiringRequestForm />
    </Suspense>
  );
}
