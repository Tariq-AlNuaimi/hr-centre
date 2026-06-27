import { NextRequest } from "next/server";
import { withAdminAuth } from "@/lib/api-helpers";
import { ok, err, notFound } from "@/lib/api-response";
import {
  getRoleProfile,
  approveRoleProfile,
  maskScoringKeys,
  isEditable,
} from "@/lib/services/roleProfile";

// Approve & activate a profile (UI-SPEC D.3 step 5). Admin-only. Records approver +
// timestamp, sets ACTIVE, supersedes the prior ACTIVE version. A profile with no
// competencies can't be activated (an empty target measures nothing).
export const POST = withAdminAuth(async (_req: NextRequest, { params, session }) => {
  const orgId = session.user.orgId;
  if (!orgId) return err("No organization context", 400);

  const { id } = await params;
  const profile = await getRoleProfile(orgId, id);
  if (!profile) return notFound("Role profile");

  if (!isEditable(profile.status)) {
    return err("Only a draft/in-review version can be approved", 409);
  }
  if (profile.competencies.length === 0) {
    return err("Add at least one competency before approving", 400);
  }

  const activated = await approveRoleProfile(profile, session.user.id);
  return ok(maskScoringKeys(activated, true));
});
