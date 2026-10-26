import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { CandidateProfile } from "@/components/hiring/candidates/CandidateProfile";

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<PageSkeleton rows={8} />}>
      <CandidateProfile id={id} />
    </Suspense>
  );
}
