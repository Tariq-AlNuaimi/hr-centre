import { ScreeningView } from "@/components/hiring/requisitions/ScreeningView";

export default async function ScreeningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScreeningView id={id} />;
}
