import { Suspense } from "react";
import { FormSkeleton } from "@/components/shared/Skeletons";
import { NewOffer } from "@/components/hiring/offers/NewOffer";

export default function NewOfferPage() {
  return (
    <Suspense fallback={<FormSkeleton fields={8} />}>
      <NewOffer />
    </Suspense>
  );
}
