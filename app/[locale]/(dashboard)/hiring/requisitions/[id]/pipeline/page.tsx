import { RequisitionPipeline } from "@/components/hiring/requisitions/RequisitionPipeline";

export default async function RequisitionPipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RequisitionPipeline id={id} />;
}
