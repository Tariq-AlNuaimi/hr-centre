import { PanelScore } from "@/components/hiring/panel/PanelScore";

export default async function PanelScorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PanelScore id={id} />;
}
