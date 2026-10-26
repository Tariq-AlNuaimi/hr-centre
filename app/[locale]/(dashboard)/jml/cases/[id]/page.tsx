import { Suspense } from "react";
import { CaseScreen } from "@/components/jml/case/CaseScreen";
import { LoadingBlock } from "@/components/jml/States";

/** One case — checklist, overview, emails, activity and every action. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<LoadingBlock />}>
      <CaseScreen caseId={id} />
    </Suspense>
  );
}
