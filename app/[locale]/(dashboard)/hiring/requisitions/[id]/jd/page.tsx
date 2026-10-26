import { JdSignoffView } from "@/components/hiring/requisitions/JdSignoffView";

export default async function JdSignoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JdSignoffView id={id} />;
}
