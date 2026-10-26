import { RequisitionForm } from "@/components/hiring/requisitions/RequisitionForm";

export default async function EditRequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequisitionForm id={id} />;
}
