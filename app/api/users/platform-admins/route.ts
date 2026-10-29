import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, forbidden } from "@/lib/api-response";
import { resolveActor } from "@/lib/core/actor";
import { canSeePlatformAdminRoster } from "@/lib/core/permissions";

/**
 * Who the platform administrators are — ADR-070, amended 2026-08-27.
 *
 * ## The gap this closes, and the one it refuses to
 *
 * ADR-070 merged the two access screens but recorded a cost: an HR Super Admin
 * who is NOT also a platform admin could see that platform administration exists
 * and who governs it, but not WHO holds it. They could not answer "who do I ask
 * to get Layla a login?" without asking someone to go and look.
 *
 * The tempting fix was to put `isPlatformAdmin` on the employee payload. That was
 * refused, and still is: `GET /api/employees` is visibility-scoped and read by
 * every signed-in employee, and "who are the administrators" is target
 * information. This endpoint gives the answer to the two audiences that govern
 * access, and to nobody else.
 *
 * ## The gate is a UNION, and deliberately not `withAdminAuth`
 *
 * A platform admin can already read the whole account directory. The audience
 * that NEEDS this is the HR Super Admin who cannot — so gating on ADMIN alone
 * would close exactly nothing. `isHrSuperAdmin` comes from the caller's role
 * assignments (lib/rbac, ADR-065), so this is the same union the `/admin/access` page renders on, and
 * the page's affordance and this control answer the same question.
 *
 * Ordinary employees, line managers, HRBPs and executive viewers all get 403.
 * HRBP is excluded on purpose: §4.1 marks them "Configures? No", and knowing the
 * administrator roster is an administration question, not a cycle-running one.
 *
 * ## What comes back
 *
 * Names and emails, nothing else — no ids, no `lastLoginAt`, no employee link.
 * Enough to address a request to a person, not enough to be a second account
 * directory for an audience that is not entitled to one. Bounded by
 * construction: this is a handful of rows in a 37-person company, and it is the
 * whole set rather than a page, because a paginated list of administrators would
 * answer the question wrongly.
 */
/**
 * How many administrators we are willing to name in a sentence. Above this the
 * answer stops being "ask one of these people" and becomes "something is wrong
 * with who holds administration", which is a different message.
 */
const MAX_LISTED = 25;

export const GET = withRateLimit(
  withAuth(async (_request: NextRequest, { session }) => {
    const actor = await resolveActor(session);
    // The rule lives in lib/core/permissions.ts with every other authority
    // question, so it is unit-testable and cannot drift from a second copy.
    if (!canSeePlatformAdminRoster(actor, session.user.role)) return forbidden();

    // BOUNDED, and the bound is a runaway guard rather than a page size.
    //
    // A paginated answer to "who do I ask?" would be a WRONG answer rather than a
    // partial one: "Platform administrators: A, B, C" reads as the complete list.
    // So this returns the whole set — but `findMany` with no `take` loads whatever
    // is there, and "whatever is there" is not a promise this route can make
    // (Scalable pillar). The compromise: read one MORE than we are willing to
    // render, so the caller can tell "this is all of them" from "there are too
    // many to be a useful answer", and say which.
    //
    // Hitting the cap is not an error state to hide — it means someone made 26+
    // people platform administrators, which is itself the thing worth surfacing.
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { name: true, email: true },
      orderBy: { name: "asc" },
      take: MAX_LISTED + 1,
    });

    return ok({
      admins: admins.slice(0, MAX_LISTED),
      // True when there are more than we will name. The UI stops listing and
      // points at the accounts list instead of printing a list that is silently
      // short.
      truncated: admins.length > MAX_LISTED,
    });
  }),
  { id: "platform-admins", limit: 60, windowMs: 60_000 },
);
