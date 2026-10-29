import { requireSection } from "@/lib/nav/page-gate";

/** The 360 console: org-wide Performance readers (a rater's form is not behind it). A real 404 before anything streams (ADR-101; this layout is outside the segment's loading boundary). */
export default async function Gate({ children }: { children: React.ReactNode }) {
  await requireSection("/three-sixty");
  return <>{children}</>;
}
