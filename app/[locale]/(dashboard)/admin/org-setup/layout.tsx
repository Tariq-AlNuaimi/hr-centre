import { requireSection } from "@/lib/nav/page-gate";

/** Org setup: who manages the org structure. A real 404 before anything streams (ADR-101; this layout is outside the segment's loading boundary). */
export default async function Gate({ children }: { children: React.ReactNode }) {
  await requireSection("/admin/org-setup");
  return <>{children}</>;
}
