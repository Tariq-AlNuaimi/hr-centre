import { requireRecord } from "@/lib/nav/record-gate";

/** A panelist's interview screens: only for someone on the panel, in scope. A real 404 before anything streams (ADR-101). */
export default async function Gate({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireRecord("hiring.panel", (await params).id);
  return <>{children}</>;
}
