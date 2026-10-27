import { PreboardingView } from "@/components/hiring/candidates/PreboardingView";

export default async function PreboardingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PreboardingView id={id} />;
}
