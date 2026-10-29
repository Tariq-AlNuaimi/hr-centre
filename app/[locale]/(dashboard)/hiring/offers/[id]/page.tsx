import { OfferDetailView } from "@/components/hiring/offers/OfferDetailView";
import { requireRecord } from "@/lib/nav/record-gate";

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRecord("hiring.offer", id);
  return <OfferDetailView id={id} />;
}
