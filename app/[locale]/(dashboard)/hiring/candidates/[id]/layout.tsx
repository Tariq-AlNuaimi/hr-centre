import { requireRecord } from "@/lib/nav/record-gate";

/** A candidate and their sub-screens, as the candidate read route decides. A real 404 before anything streams (ADR-101). */
export default async function Gate({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireRecord("hiring.candidate", (await params).id);
  return <>{children}</>;
}
