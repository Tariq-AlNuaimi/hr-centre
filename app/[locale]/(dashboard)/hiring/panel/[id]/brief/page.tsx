import { PanelBrief } from "@/components/hiring/panel/PanelBrief";

export default async function PanelBriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PanelBrief id={id} />;
}
