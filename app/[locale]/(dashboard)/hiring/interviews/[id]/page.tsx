import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/Skeletons";
import { InterviewDetail } from "@/components/hiring/interviews/InterviewDetail";
import { requireRecord } from "@/lib/nav/record-gate";

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRecord("hiring.interview", id);
  return (
    <Suspense fallback={<PageSkeleton rows={6} />}>
      <InterviewDetail id={id} />
    </Suspense>
  );
}
