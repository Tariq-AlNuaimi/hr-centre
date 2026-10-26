import { ApprovalView } from "@/components/hiring/requisitions/ApprovalView";

export default async function RequisitionApprovalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ApprovalView id={id} />;
}
