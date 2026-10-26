import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { RequisitionView } from "@/components/hiring/requisitions/RequisitionView";

export default async function RequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RequisitionView id={id} />
    </Suspense>
  );
}
