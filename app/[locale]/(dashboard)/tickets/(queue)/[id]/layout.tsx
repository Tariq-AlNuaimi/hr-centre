import { requireRecord } from "@/lib/nav/record-gate";

/** One ticket, as GET /api/hive/escalations/[id] decides. A real 404 before anything streams (ADR-101). */
export default async function Gate({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireRecord("ticket", (await params).id);
  return <>{children}</>;
}
