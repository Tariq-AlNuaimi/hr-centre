import { requireSection } from "@/lib/nav/page-gate";

/** Calibration: who may run it. A real 404 before anything streams (ADR-101; this layout is outside the segment's loading boundary). */
export default async function Gate({ children }: { children: React.ReactNode }) {
  await requireSection("/calibration");
  return <>{children}</>;
}
