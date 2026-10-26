import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getHivePermissions } from "@/lib/hive/services/permissions";

/**
 * Server gate for the escalation queue, matching its routes' `draftEscalation`.
 *
 * §5.3 gives the five standard HR accounts one shared, company-wide queue, so
 * the permission that opens the screen is the one that lets you work on it —
 * not ADMIN, and not `approve`. Alaa holds Admin and NOT approve; that
 * separation is the reason these are four independent booleans.
 *
 * Gated here as well as on every route because the pages are client components:
 * without it an unpermitted user gets the full queue shell with 403s behind it,
 * and a screen asserting "nothing waiting" about a backlog is worse than no
 * screen. `notFound()` rather than a message, matching the other HIVE screens.
 */
export default async function HiveEscalationsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const permissions = await getHivePermissions(session.user.id);
  if (!permissions.seeTickets) notFound();
  return <>{children}</>;
}
