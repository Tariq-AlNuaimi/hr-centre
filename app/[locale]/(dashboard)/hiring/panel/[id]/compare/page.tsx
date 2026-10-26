import { PanelCompare } from "@/components/hiring/panel/PanelCompare";

export default async function PanelComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PanelCompare id={id} />;
}
