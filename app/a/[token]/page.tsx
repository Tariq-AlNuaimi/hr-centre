import {
  resolveToken,
  getBilingualItems,
  getBilingualSjtItems,
  getSavedResponses,
  getInvitationDisplay,
} from "@/lib/services/candidateRunner";
import { Runner, type RunnerData } from "./Runner";
import { TokenStateScreen } from "./TokenStateScreen";

// The candidate runner page (UI-SPEC C.1–C.5). An RSC: it resolves the opaque
// token to a state, fetches the bilingual render payload server-side (scoringKey
// never selected), and hands the active flow to the <Runner> client component.
// Non-active states render a calm, branded screen (not a raw Next 404).
export default async function CandidateRunnerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await resolveToken(token);

  if (res.state !== "active") {
    return <TokenStateScreen state={res.state} />;
  }

  const { invitation } = res;

  // Load the active-flow payload in parallel. SavedResponses only when an
  // assessment exists (i.e. consent already recorded → resume).
  const [items, sjt, display, saved] = await Promise.all([
    getBilingualItems(),
    getBilingualSjtItems(invitation.roleProfileId),
    getInvitationDisplay(invitation.id, invitation.orgId),
    invitation.assessment
      ? getSavedResponses(invitation.assessment.id, invitation.orgId)
      : Promise.resolve({ items: [], sjt: [] }),
  ]);

  const initialLocale =
    (invitation.assessment?.locale ?? invitation.locale) === "ar" ? "ar" : "en";

  const data: RunnerData = {
    token,
    roleTitle: display?.roleTitle ?? "",
    initialLocale,
    consented: Boolean(invitation.assessment?.consentAt),
    items,
    sjt,
    savedItems: saved.items,
    savedSjt: saved.sjt,
    itemsPerScreen: 5,
  };

  return <Runner data={data} />;
}
