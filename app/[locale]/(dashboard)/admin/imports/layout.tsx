import { requireSection } from "@/lib/nav/page-gate";

/** The imports hub: anyone with an importer (ADR-096). A real 404 before anything streams (ADR-101; this layout is outside the segment's loading boundary). */
export default async function Gate({ children }: { children: React.ReactNode }) {
  await requireSection("/admin/imports");
  return <>{children}</>;
}
