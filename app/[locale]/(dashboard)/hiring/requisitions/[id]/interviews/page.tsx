import { RequisitionSchedule } from "@/components/hiring/requisitions/RequisitionSchedule";

export default async function RequisitionInterviewsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RequisitionSchedule id={id} />;
}
