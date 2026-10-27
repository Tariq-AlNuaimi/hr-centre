import { OfferDetailView } from "@/components/hiring/offers/OfferDetailView";

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfferDetailView id={id} />;
}
