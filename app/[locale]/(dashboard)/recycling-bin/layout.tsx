import { requireSection } from "@/lib/nav/page-gate";

/** The recycling bin: platform admins. A real 404 before anything streams (ADR-101; this layout is outside the segment's loading boundary). */
export default async function Gate({ children }: { children: React.ReactNode }) {
  await requireSection("/recycling-bin");
  return <>{children}</>;
}
