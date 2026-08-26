import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/PageHeader";
import { ThreeSixtyForm } from "@/components/pms/ThreeSixtyForm";

/**
 * §9.7 — one rater answering one 360 assessment.
 *
 * Deliberately NOT under the HR console at `/three-sixty`: that screen is §9.4's
 * who-assesses-whom map, which is HR's and which §13.1 keeps away from everyone
 * else. This route is reached from My Tasks (§4.4 — "driven by assignment"), and
 * the assignment id in the URL is authorised by the route behind it, which
 * answers 404 for anyone who is not the assigned rater.
 *
 * No gate here in the page: an authorisation check in a server component that
 * the API also performs is a second copy of the rule, free to drift. The form
 * renders what the API returns, and the API returns nothing for a stranger.
 */
export default async function ThreeSixtyAssignmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const t = await getTranslations("pms.threeSixtyForm");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <ThreeSixtyForm assignmentId={assignmentId} />
    </div>
  );
}
