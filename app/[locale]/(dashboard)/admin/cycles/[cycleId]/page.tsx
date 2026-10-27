import { CycleConsole } from "@/components/pms/CycleConsole";

/** One performance cycle's console (docs/blueprints/ux-p1-performance.md). */
export default async function CyclePage({ params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  return <CycleConsole cycleId={cycleId} />;
}
