import { ComparisonView } from "@/components/hiring/requisitions/ComparisonView";

export default async function RequisitionComparisonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ComparisonView id={id} />;
}
