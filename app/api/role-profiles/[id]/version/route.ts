import { NextRequest } from "next/server";
import { withAdminAuth } from "@/lib/api-helpers";
import { err, created, notFound } from "@/lib/api-response";
import {
  getRoleProfile,
  cloneNewVersion,
  maskScoringKeys,
} from "@/lib/services/roleProfile";

// Clone a profile into a new DRAFT version of the same lineage (UI-SPEC D.2/D.4
// "new version"). Admin-only. The source version is never mutated.
export const POST = withAdminAuth(async (_req: NextRequest, { params, session }) => {
  const orgId = session.user.orgId;
  if (!orgId) return err("No organization context", 400);

  const { id } = await params;
  const source = await getRoleProfile(orgId, id);
  if (!source) return notFound("Role profile");

  const clone = await cloneNewVersion(source, session.user.id);
  // Admin-only, but mask explicitly so the contract is in the payload shape, not
  // just the wrapper (senior-review T-12). No-op for admins; future-proofs a
  // wrapper change from silently leaking SJT keys.
  return created(maskScoringKeys(clone, true));
});
