import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getHivePermissions } from "@/lib/hive/services/permissions";

/**
 * Server gate for the reporting screen, matching its route's View reports
 * grant. Same reasoning as the queue's layout: the page is a client component,
 * and without this an unpermitted user gets the shell with a 403 behind it.
 */
export default async function HiveReportsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const permissions = await getHivePermissions(session.user.id);
  if (!permissions.viewReports) notFound();
  return <>{children}</>;
}
