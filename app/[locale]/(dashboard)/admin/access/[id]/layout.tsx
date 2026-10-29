import { requireRecord } from "@/lib/nav/record-gate";

/** A login on the access screen. A real 404 before anything streams (ADR-101). */
export default async function Gate({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireRecord("login", (await params).id);
  return <>{children}</>;
}
