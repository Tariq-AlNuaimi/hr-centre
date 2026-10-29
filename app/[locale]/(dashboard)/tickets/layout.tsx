import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getHivePermissions } from "@/lib/hive/services/permissions";

/**
 * QA2 N-17 — the outer gate for every HR tickets screen.
 *
 * The finer gates live in the queue, reports and setup layouts, but those sit
 * INSIDE this segment's `loading.tsx` Suspense boundary: by the time they call
 * `notFound()` the 200 status has already been streamed, so a plain employee
 * got "404 Page not found" in a 200 response. This layout is outside that
 * boundary (a segment's loading.tsx wraps its children, not its own layout),
 * so someone with no ticket permission at all gets a real HTTP 404.
 */
export default async function TicketsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const permissions = await getHivePermissions(session.user.id);
  if (!Object.values(permissions).some(Boolean)) notFound();
  return <>{children}</>;
}
