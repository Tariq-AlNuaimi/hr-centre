import { CycleConsole } from "@/components/pms/CycleConsole";
import { requireRecord } from "@/lib/nav/record-gate";

/** One performance cycle's console (docs/blueprints/ux-p1-performance.md). */
export default async function CyclePage({ params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  await requireRecord("pms.cycle", cycleId);
  return <CycleConsole cycleId={cycleId} />;
}
