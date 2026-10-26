import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok } from "@/lib/api-response";
import { listAuthorities, saveAuthority } from "@/lib/jml/leave/authority";
import { body, jml, requireGroup } from "@/lib/jml/route";
import { authoritySchema } from "@/lib/validations/jml/leave";

/** Approval authority per type (holder label, delegate, second-level delegate). */
export const GET = withRateLimit(
  withAuth(
    jml(async ({ actor }) => {
      requireGroup(actor, "jml.configure");
      return ok(await listAuthorities());
    }),
  ),
  { id: "jml-config-read", limit: 60, windowMs: 60_000 },
);

export const PUT = withRateLimit(
  withAuth(
    jml(async ({ req, actor }) => {
      requireGroup(actor, "jml.manageApprovalAuthority");
      return ok(await saveAuthority(await body(req, authoritySchema)));
    }),
  ),
  { id: "jml-config-write", limit: 30, windowMs: 60_000 },
);
