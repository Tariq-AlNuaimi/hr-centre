import { requireRecord } from "@/lib/nav/record-gate";

/** A requisition and its sub-screens, as GET /api/hiring/requisitions/[id] decides. A real 404 before anything streams (ADR-101). */
export default async function Gate({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireRecord("hiring.requisition", (await params).id);
  return <>{children}</>;
}
