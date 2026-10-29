import { JoinerList } from "@/components/jml/joiners/JoinerList";
import { requireSection } from "@/lib/nav/page-gate";

/** Joiners — drafts and activated onboardings (HR Onboarding /new-hires). */
export default async function Page() {
  await requireSection("/jml/joiners");
  return <JoinerList />;
}
