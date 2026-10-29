import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CaseScreen } from "@/components/jml/case/CaseScreen";
import { LoadingBlock } from "@/components/jml/States";

/** A case id is a cuid; anything else (undefined, null, a ref typed by hand) is not one. */
const isCaseId = (id: string) => /^[a-z0-9]{20,40}$/i.test(id) && !/^(undefined|null)$/i.test(id);

/** One case — checklist, overview, emails, activity and every action. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // QA2 N-20 — "/jml/cases/undefined" (a link built from a missing id) is not
  // a case: a not-found page, not an empty screen with an "Undefined" crumb.
  if (!isCaseId(id)) notFound();
  return (
    <Suspense fallback={<LoadingBlock />}>
      <CaseScreen caseId={id} />
    </Suspense>
  );
}
